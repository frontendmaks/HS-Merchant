/**
 * Turning a collector's rendered page into stored offers.
 *
 * The same parsing, scoring and per-kilogram arithmetic the ordinary pass uses
 * — reached from a different direction. A page that arrives from a browser is
 * treated exactly like one this server fetched itself, which is the only way
 * the two sources can produce comparable numbers.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { productLinks, fromCards, fromJson, type Found } from '@/lib/price-scrape'
import { contextLabel, contextMatches } from '@/lib/meat-context'
import {
  similarity, extractAmount, pricePerKg, ourPricePerKg, unitGrams, sameKind,
  MATCH_MODES, isMatchMode, type MatchMode,
} from '@/lib/price-monitor'

type Service = ReturnType<typeof createServiceClient>

/** Enqueues the pages a browser will have to open for this product. */
export async function enqueueRender(
  service: Service,
  competitorId: string,
  productId: string,
  urls: { url: string; query: string }[],
) {
  if (!urls.length) return

  // Не ставимо в чергу те, що там уже стоїть або що збирач щойно успішно
  // опрацював. Невдалі спроби до цього не належать: сторінка могла не
  // відповісти, і пропускати її пів доби означало б, що одна випадкова
  // помилка мовчки викреслює товар до завтра.
  const since = new Date(Date.now() - 12 * 3600_000).toISOString()
  const { data: recent } = await service
    .from('price_render_tasks')
    .select('url, status')
    .eq('competitor_id', competitorId)
    .eq('product_id', productId)
    .in('status', ['pending', 'taken', 'done'])
    .gte('created_at', since)

  const known = new Set((recent ?? []).map(r => r.url as string))
  const fresh = urls.filter(u => !known.has(u.url))
  if (!fresh.length) return

  await service.from('price_render_tasks').insert(
    fresh.map(u => ({
      competitor_id: competitorId, product_id: productId,
      url: u.url, query: u.query,
    })),
  )
}

/**
 * @returns how many offers were stored
 */
export async function storeRendered(
  service: Service,
  taskId: string,
  html: string,
): Promise<number> {
  const { data: task } = await service
    .from('price_render_tasks')
    .select('id, competitor_id, product_id, url')
    .eq('id', taskId).single()

  if (!task) return 0

  const done = async (stored: number, error?: string) => {
    await service.from('price_render_tasks').update({
      status: error ? 'failed' : 'done',
      error: error ?? null,
      done_at: new Date().toISOString(),
      // The page itself is not kept: it is megabytes per task and nothing
      // downstream reads it once the offers are out
      html: null,
    }).eq('id', taskId)
    return stored
  }

  const [{ data: product }, { data: watch }, { data: rival }] = await Promise.all([
    service.from('products').select('id, name, price').eq('id', task.product_id).single(),
    service.from('price_watches').select('match_mode').eq('product_id', task.product_id).single(),
    service.from('price_competitors').select('site_url, city_path').eq('id', task.competitor_id).single(),
  ])

  if (!product) return done(0, 'Товар більше не відстежується')

  const mode: MatchMode = isMatchMode(watch?.match_mode) ? watch.match_mode : 'similar'

  // A rendered page may still be JSON — some shops answer their own search that
  // way and the browser merely displayed it
  const trimmed = html.trimStart()
  let items: Found[] = trimmed.startsWith('{') || trimmed.startsWith('[')
    ? fromJson(html, task.url)
    : []

  if (!items.length) {
    const links = productLinks(html, task.url)
    items = fromCards(html, links, task.url, rival?.city_path ?? '')
  }

  if (!items.length) return done(0, 'На сторінці не знайдено товарів')

  const ourName = product.name as string
  const ourAmount = extractAmount(ourName)
  const ourPerKg = ourPricePerKg(Number(product.price ?? 0), ourAmount)

  const { data: refused } = await service
    .from('price_rejections')
    .select('competitor_title')
    .eq('product_id', task.product_id)
    .eq('competitor_id', task.competitor_id)

  const rejected = new Set((refused ?? []).map(r => r.competitor_title as string))

  const scored = items
    .filter(i => !rejected.has(i.title))
    .filter(i => sameKind(ourName, i.title))
    .map(i => ({ ...i, score: similarity(ourName, i.title, mode) }))
    .sort((a, b) => b.score - a.score)
    .filter(i => i.score >= MATCH_MODES[mode].floor)
    .slice(0, 5)

  if (!scored.length) return done(0, 'Схожої позиції не знайдено')

  const now = new Date().toISOString()
  for (const offer of scored) {
    const theirs = extractAmount(offer.title)
    const basis = unitGrams(offer.unitLabel ?? '') ?? theirs

    await service.from('price_matches').upsert({
      product_id: product.id,
      competitor_id: task.competitor_id,
      competitor_title: offer.title,
      competitor_url: offer.url ?? `#${offer.title}`,
      price: offer.price,
      price_per_kg: basis ? pricePerKg(offer.price, basis) : offer.price,
      our_price_per_kg: ourPerKg,
      our_amount: ourAmount,
      competitor_amount: theirs,
      unit_label: offer.unitLabel ?? null,
      similarity: offer.score,
      context_label: contextLabel(offer.title) || null,
      context_note: contextMatches(ourName, offer.title).reason,
      checked_at: now,
      error: null,
    }, { onConflict: 'product_id,competitor_id,competitor_url' })
  }

  await service.from('price_competitors')
    .update({ last_checked_at: now, last_error: null })
    .eq('id', task.competitor_id)

  return done(scored.length)
}

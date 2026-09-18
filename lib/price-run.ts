/**
 * One pass over every watched product against every active competitor.
 *
 * Shared by the daily job and the "перевірити зараз" button, so the two can
 * never drift into checking different things.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { searchCompetitor, siteChrome, type Found } from '@/lib/price-scrape'
import { fetchCatalog, shortlist, readProduct, withCity } from '@/lib/price-catalog'
import { contextLabel, contextMatches } from '@/lib/meat-context'
import { enqueueRender } from '@/lib/price-render'
import { buildSearchUrl } from '@/lib/price-scrape'
import {
  similarity, extractAmount, scaleToOurPack, queryVariants, sameKind,
  pricePerKg, ourPricePerKg, unitGrams, MATCH_MODES, isMatchMode, type MatchMode,
} from '@/lib/price-monitor'

type Service = ReturnType<typeof createServiceClient>

/** Sites are queried one at a time with a gap — a shop's search is not an API
 *  and hammering it is both rude and a fast way to get blocked. */
const GAP_MS = 1200
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export interface RunResult {
  products: number
  competitors: number
  matched: number
  missed: number
  errors: string[]
}

/** How long a sitemap reading stays good enough to reuse. */
const CATALOG_TTL_MS = 3 * 864e5

/**
 * Candidate listings for one product at one competitor.
 *
 * Two ways in. A shop with a search gets asked; a shop without one — and there
 * are many, including whole platforms that render search in script — gets read
 * from its own sitemap instead. The second path opens only the few pages whose
 * address looks like the product, so it costs a handful of requests rather
 * than a crawl.
 */
type Rival = {
  id: string; search_url: string | null; site_url: string; city_path: string
  catalog_urls: unknown; catalog_synced_at: string | null
}

async function candidates(
  service: Service,
  rival: Rival,
  productName: string,
  chrome?: Set<string>,
  /** Пропустити пошук і одразу читати каталог */
  catalogOnly = false,
): Promise<{ items: Found[]; error?: string }> {
  if (rival.search_url && !catalogOnly) {
    let lastError: string | undefined
    for (const query of queryVariants(productName)) {
      const attempt = await searchCompetitor(
        withCity(rival.search_url, rival.city_path), query, 15_000, rival.city_path, chrome)
      if (attempt.items.length) return attempt
      lastError = attempt.error
      await sleep(500)
    }
    return { items: [], error: lastError ?? 'Пошук нічого не повернув' }
  }

  let urls = Array.isArray(rival.catalog_urls) ? rival.catalog_urls as string[] : []
  const stale = !rival.catalog_synced_at
    || Date.now() - new Date(rival.catalog_synced_at).getTime() > CATALOG_TTL_MS

  if (!urls.length || stale) {
    const fresh = await fetchCatalog(rival.site_url)
    if (fresh.error && !urls.length) return { items: [], error: fresh.error }
    if (fresh.urls.length) {
      urls = fresh.urls
      rival.catalog_urls = urls
      rival.catalog_synced_at = new Date().toISOString()
      await service.from('price_competitors')
        .update({ catalog_urls: urls, catalog_synced_at: rival.catalog_synced_at })
        .eq('id', rival.id)
    }
  }

  if (!urls.length) return { items: [], error: 'Каталог сайту не прочитався' }

  const picked = shortlist(productName, urls, 5)
  if (!picked.length) return { items: [], error: 'Схожої позиції немає в каталозі' }

  const items: Found[] = []
  for (const raw of picked) {
    const url = withCity(raw, rival.city_path)
    const page = await readProduct(url)
    await sleep(400)
    if (page) items.push({ title: page.title, price: page.price, url })
  }
  return items.length ? { items } : { items: [], error: 'Сторінки товарів не прочитались' }
}

export async function runPriceCheck(
  service: Service = createServiceClient(),
  runId?: string,
  /** One product instead of every watched one */
  onlyProductId?: string,
): Promise<RunResult> {
  const [{ data: watches }, { data: competitors }] = await Promise.all([
    service.from('price_watches').select('product_id, match_mode'),
    // No search_url filter any more: a site without one is read from its
    // sitemap instead of being skipped
    service.from('price_competitors')
      .select(`id, name, site_url, search_url, city_path, readable,
               catalog_urls, catalog_synced_at`)
      .eq('is_active', true),
  ])

  const productIds = (watches ?? [])
    .map(w => w.product_id as string)
    .filter(id => !onlyProductId || id === onlyProductId)
  const modeOf = new Map<string, MatchMode>(
    (watches ?? []).map(w => [
      w.product_id as string,
      isMatchMode(w.match_mode) ? w.match_mode : 'similar',
    ]),
  )
  const rivals = competitors ?? []
  const result: RunResult = {
    products: productIds.length, competitors: rivals.length,
    matched: 0, missed: 0, errors: [],
  }
  if (runId) {
    await service.from('price_runs')
      .update({ total: productIds.length * rivals.length }).eq('id', runId)
  }

  if (!productIds.length || !rivals.length) return result

  const { data: products } = await service
    .from('products').select('id, name, price').in('id', productIds)

  /**
   * Те, що людина вже вирішила.
   *
   * Підтверджену позицію не треба шукати вдруге: ми знаємо її сторінку й
   * читаємо ціну прямо звідти. Пошук лишається для нового — нових товарів і
   * нових конкурентів. Це і швидше, і стабільніше: результат не залежить від
   * того, що сьогодні віддасть пошук магазину.
   */
  const { data: pins } = await service
    .from('price_matches')
    .select('id, product_id, competitor_id, competitor_title, pinned_url')
    .not('pinned_url', 'is', null)

  const pinnedBy = new Map<string, { id: string; pinned_url: string; competitor_title: string | null }>()
  for (const m of pins ?? []) {
    pinnedBy.set(`${m.product_id}|${m.competitor_id}`, {
      id: m.id as string,
      pinned_url: m.pinned_url as string,
      competitor_title: m.competitor_title as string | null,
    })
  }

  // Відхилене людиною — щоб не пропонувати той самий хибний збіг знову
  const { data: refused } = await service
    .from('price_rejections').select('product_id, competitor_id, competitor_title')

  const rejected = new Set(
    (refused ?? []).map(r => `${r.product_id}|${r.competitor_id}|${r.competitor_title}`),
  )

  const now = new Date().toISOString()

  for (const rival of rivals) {
    // A site that refuses our server is not skipped — the pages it would have
    // been asked for are written down for the collector to open in a browser
    if (!rival.readable) {
      if (rival.search_url) {
        for (const product of products ?? []) {
          const queries = queryVariants(product.name as string).slice(0, 2)
          await enqueueRender(service, rival.id as string, product.id as string,
            queries.map(query => ({
              url: buildSearchUrl(rival.search_url as string, query),
              query,
            })))
        }
      }
      continue
    }

    let siteError: string | null = null
    // Read once per competitor, not per product: it is the same menu every time
    const chrome = await siteChrome(rival.site_url as string)

    for (const product of products ?? []) {
      const key = `${product.id}|${rival.id}`
      const pin = pinnedBy.get(key)

      // Підтверджена позиція: просто перечитуємо її сторінку
      if (pin) {
        const page = await readProduct(withCity(pin.pinned_url, rival.city_path))
        await sleep(GAP_MS)

        if (page) {
          const theirs = extractAmount(page.title)
          const ourAmount = extractAmount(product.name as string)
          await service.from('price_matches').update({
            price: page.price,
            price_per_kg: theirs ? pricePerKg(page.price, theirs) : page.price,
            our_price_per_kg: ourPricePerKg(Number(product.price ?? 0), ourAmount),
            competitor_amount: theirs,
            checked_at: now,
            error: null,
          }).eq('id', pin.id)

          await service.from('price_snapshots').insert({
            product_id: product.id, competitor_id: rival.id,
            price: page.price, our_price: product.price,
          })
          result.matched++
        } else {
          await service.from('price_matches')
            .update({ checked_at: now, error: 'Сторінка не відповіла' }).eq('id', pin.id)
          result.missed++
        }
        continue
      }

      if (runId) {
        await service.from('price_runs').update({
          done: result.matched + result.missed,
          matched: result.matched, missed: result.missed,
          current_step: `${rival.name}: ${(product.name as string).slice(0, 60)}`,
        }).eq('id', runId)
      }

      const { items, error } = await candidates(service, rival, product.name as string, chrome)
      await sleep(GAP_MS)

      if (error) {
        siteError = error
        await service.from('price_matches').upsert({
          product_id: product.id, competitor_id: rival.id,
          competitor_url: '', competitor_title: null,
          checked_at: now, error,
        }, { onConflict: 'product_id,competitor_id,competitor_url' })
        result.missed++
        continue
      }

      const mode = modeOf.get(product.id as string) ?? 'similar'
      const ourAmount = extractAmount(product.name as string)

      // A confirmed match is re-priced from the same listing, not re-matched
      // The kind has to match before the score matters. Searching «куряче»
      // returns everything a poultry shop sells, and a score alone let kebabs
      // and sausage sit in the details of a chicken thigh.
      const scored = items
        .filter(i => !rejected.has(`${product.id}|${rival.id}|${i.title}`))
        .filter(i => sameKind(product.name as string, i.title))
        .map(i => ({ ...i, score: similarity(product.name as string, i.title, mode) }))
        .sort((a, b) => b.score - a.score)

      const best = scored[0]

      /**
       * Пошук магазину — не те саме, що його асортимент.
       *
       * «Гомілка куряча» лежить у Родинної за адресою /product/homilka-kuriacha,
       * але їхній пошук на «гомілка» віддає лише мариновані й копчені варіанти.
       * Товар є, знайти його через пошук неможливо — тож коли пошук нічого не
       * дав, дивимось у каталог сайту, який ми й так маємо з їхньої карти.
       */
      if ((!best || best.score < MATCH_MODES[mode].floor) && rival.search_url) {
        const viaCatalog = await candidates(service, rival, product.name as string, chrome, true)
        const rescored = viaCatalog.items
          .filter(i => !rejected.has(`${product.id}|${rival.id}|${i.title}`))
          .filter(i => sameKind(product.name as string, i.title))
          .map(i => ({ ...i, score: similarity(product.name as string, i.title, mode) }))
          .sort((a, b) => b.score - a.score)

        if (rescored.length && rescored[0].score >= MATCH_MODES[mode].floor) {
          scored.length = 0
          scored.push(...rescored)
        }
      }

      const chosen = scored[0]
      if (!chosen || chosen.score < MATCH_MODES[mode].floor) {
        // Nothing acceptable today means yesterday's guesses are not acceptable
        // either. Without this a match the vocabulary now rejects — a turkey
        // thigh under a chicken one — sits in the details for ever, because the
        // cleanup only ran when there was something to replace it with.
        await service.from('price_matches')
          .delete()
          .eq('product_id', product.id)
          .eq('competitor_id', rival.id)
          .eq('status', 'auto')
          .eq('is_chosen', false)
          .eq('is_manual', false)
          .neq('competitor_url', '')

        await service.from('price_matches').upsert({
          product_id: product.id, competitor_id: rival.id,
          competitor_url: '', competitor_title: null,
          checked_at: now, error: 'Схожої позиції не знайдено',
          price: null, similarity: chosen ? chosen.score : null,
        }, { onConflict: 'product_id,competitor_id,competitor_url' })
        result.missed++
        continue
      }

      // Every offer worth showing, not only the winner. One shop can carry the
      // same sausage twice — «Дрогобицька» and «Дрогобицька ТЕР в/с» — and
      // storing one of them hides a price the buyer can plainly see.
      const keep = scored.filter(i => i.score >= MATCH_MODES[mode].floor).slice(0, 5)
      const ourPerKg = ourPricePerKg(Number(product.price ?? 0), ourAmount)

      for (const offer of keep) {
        const theirs = extractAmount(offer.title)
        const norm = MATCH_MODES[mode].allowScaling
          ? scaleToOurPack(offer.price, theirs, ourAmount)
          : null

        // Per kilogram: from the unit the shop printed if it gave one,
        // otherwise from the weight in the name
        const basis = unitGrams(offer.unitLabel ?? '') ?? theirs
        // No unit printed and no weight in the name means a weight good priced
        // by the kilogram — the same rule we apply to our own prices, so both
        // sides of the comparison are read the same way
        const perKg = basis ? pricePerKg(offer.price, basis) : offer.price

        await service.from('price_matches').upsert({
          product_id: product.id, competitor_id: rival.id,
          price_per_kg: perKg, our_price_per_kg: ourPerKg,
          context_label: contextLabel(offer.title) || null,
          context_note: contextMatches(product.name as string, offer.title).reason,
          unit_label: offer.unitLabel ?? null,
          competitor_title: offer.title,
          // A shop that answers in JSON may give no link, and every offer then
          // shares one key and overwrites the last. The title is what
          // distinguishes them, so it becomes the key.
          competitor_url: offer.url ?? `#${offer.title}`,
          price: offer.price, similarity: offer.score,
          our_amount: ourAmount, competitor_amount: theirs,
          normalized_price: norm,
          checked_at: now, error: null,
        }, { onConflict: 'product_id,competitor_id,competitor_url' })
      }

      // Anything this competitor no longer returns, unless a person pinned it.
      // The error placeholder is keyed on an empty url and is not an offer.
      const keptUrls = [...keep.map(k => k.url ?? `#${k.title}`), '']
      if (keptUrls.length) {
        await service.from('price_matches')
          .delete()
          .eq('product_id', product.id)
          .eq('competitor_id', rival.id)
          .eq('status', 'auto')
          .eq('is_chosen', false)
          .eq('is_manual', false)
          .not('competitor_url', 'in', `(${keptUrls.map(u => `"${u}"`).join(',')})`)
      }

      const theirAmount = extractAmount(chosen.title)
      // Only where the mode permits it: under «Точна позиція» a different pack
      // is a different offer, and scaling it would invent a comparison the
      // setting exists to refuse
      const normalized = MATCH_MODES[mode].allowScaling
        ? scaleToOurPack(chosen.price, theirAmount, ourAmount)
        : null

      await service.from('price_snapshots').insert({
        product_id: product.id, competitor_id: rival.id,
        price: normalized ?? best.price, our_price: product.price,
      })
      result.matched++
    }

    await service.from('price_competitors')
      .update({ last_checked_at: now, last_error: siteError })
      .eq('id', rival.id)

    if (siteError) result.errors.push(`${rival.name}: ${siteError}`)
  }

  return result
}

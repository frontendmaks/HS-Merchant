/**
 * One pass over every watched product against every active competitor.
 *
 * Shared by the daily job and the "перевірити зараз" button, so the two can
 * never drift into checking different things.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { searchCompetitor } from '@/lib/price-scrape'
import {
  similarity, extractAmount, scaleToOurPack, MATCH_MODES, isMatchMode,
  type MatchMode,
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

export async function runPriceCheck(service: Service = createServiceClient()): Promise<RunResult> {
  const [{ data: watches }, { data: competitors }] = await Promise.all([
    service.from('price_watches').select('product_id, match_mode'),
    service.from('price_competitors').select('id, name, search_url')
      .eq('is_active', true).not('search_url', 'is', null),
  ])

  const productIds = (watches ?? []).map(w => w.product_id as string)
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
  if (!productIds.length || !rivals.length) return result

  const { data: products } = await service
    .from('products').select('id, name, price').in('id', productIds)

  // A person's own correction outranks anything the matcher decides today
  const { data: pinned } = await service
    .from('price_matches')
    .select('product_id, competitor_id, status, competitor_title, competitor_url, price')
    .in('status', ['confirmed', 'rejected'])

  const decided = new Map(
    (pinned ?? []).map(m => [`${m.product_id}|${m.competitor_id}`, m]),
  )

  const now = new Date().toISOString()

  for (const rival of rivals) {
    let siteError: string | null = null

    for (const product of products ?? []) {
      const key = `${product.id}|${rival.id}`
      const decision = decided.get(key)

      // Rejected by hand: do not keep proposing it every morning
      if (decision?.status === 'rejected') continue

      const { items, error } = await searchCompetitor(rival.search_url, product.name as string)
      await sleep(GAP_MS)

      if (error) {
        siteError = error
        await service.from('price_matches').upsert({
          product_id: product.id, competitor_id: rival.id,
          checked_at: now, error,
        }, { onConflict: 'product_id,competitor_id' })
        result.missed++
        continue
      }

      const mode = modeOf.get(product.id as string) ?? 'similar'
      const ourAmount = extractAmount(product.name as string)

      // A confirmed match is re-priced from the same listing, not re-matched
      const scored = items
        .map(i => ({ ...i, score: similarity(product.name as string, i.title, mode) }))
        .sort((a, b) => b.score - a.score)

      const best = decision?.status === 'confirmed' && decision.competitor_title
        ? scored.find(i => i.title === decision.competitor_title) ?? scored[0]
        : scored[0]

      if (!best || best.score < MATCH_MODES[mode].floor) {
        await service.from('price_matches').upsert({
          product_id: product.id, competitor_id: rival.id,
          checked_at: now, error: 'Схожої позиції не знайдено',
          price: null, similarity: best ? best.score : null,
        }, { onConflict: 'product_id,competitor_id' })
        result.missed++
        continue
      }

      const theirAmount = extractAmount(best.title)
      // Only where the mode permits it: under «Точна позиція» a different pack
      // is a different offer, and scaling it would invent a comparison the
      // setting exists to refuse
      const normalized = MATCH_MODES[mode].allowScaling
        ? scaleToOurPack(best.price, theirAmount, ourAmount)
        : null

      await service.from('price_matches').upsert({
        product_id: product.id, competitor_id: rival.id,
        competitor_title: best.title, competitor_url: best.url,
        price: best.price, similarity: best.score,
        our_amount: ourAmount, competitor_amount: theirAmount,
        normalized_price: normalized,
        status: decision?.status === 'confirmed' ? 'confirmed' : 'auto',
        checked_at: now, error: null,
      }, { onConflict: 'product_id,competitor_id' })

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

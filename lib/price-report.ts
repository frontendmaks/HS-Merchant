/**
 * The morning summary, sent after the 09:30 pass.
 *
 * Counts are computed the same way the page computes them — same advise(),
 * same per-competitor choice — so the notification and the screen can never
 * tell different stories about the same morning.
 */
import { createServiceClient } from '@/lib/supabase/service'
import {
  advise, MATCH_MODES, isMatchMode, DEFAULT_THRESHOLDS, type Thresholds,
} from '@/lib/price-monitor'

type Service = ReturnType<typeof createServiceClient>

export interface Report {
  expensive: number
  cheap: number
  aligned: number
  needsReview: number
  /** What the dearest mistakes are, for the body of the notice */
  worst: { name: string; gapUah: number }[]
}

export async function buildReport(service: Service): Promise<Report> {
  const [{ data: settings }, { data: watches }, { data: matches }] = await Promise.all([
    service.from('price_settings').select('*').eq('id', true).single(),
    service.from('price_watches').select('product_id, match_mode, product:products(name, price)'),
    service.from('price_matches')
      .select(`product_id, competitor_id, price, normalized_price, similarity,
               status, is_chosen, price_per_kg, our_price_per_kg`),
  ])

  const t: Thresholds = settings ? {
    minAbs: Number(settings.min_abs_uah), minPct: Number(settings.min_pct),
    undercutPct: Number(settings.undercut_pct),
  } : DEFAULT_THRESHOLDS

  const report: Report = { expensive: 0, cheap: 0, aligned: 0, needsReview: 0, worst: [] }

  for (const w of watches ?? []) {
    const product = w.product as unknown as { name: string; price: number | null } | null
    if (!product) continue

    const mode = isMatchMode(w.match_mode) ? w.match_mode : 'similar'
    const mine = (matches ?? []).filter(m => m.product_id === w.product_id)

    const perCompetitor = new Map<string, typeof mine[number]>()
    let pending = 0
    for (const m of mine) {
      if (m.status === 'rejected' || m.price == null) continue
      const usable = m.is_chosen || m.status === 'confirmed'
        || Number(m.similarity ?? 0) >= MATCH_MODES[mode].trusted
      if (!usable) { pending++; continue }

      const held = perCompetitor.get(m.competitor_id as string)
      if (!held || Number(m.similarity ?? 0) > Number(held.similarity ?? 0)) {
        perCompetitor.set(m.competitor_id as string, m)
      }
    }

    // Per kilogram wherever both sides carry it, exactly as the page does
    const chosen = [...perCompetitor.values()]
    const ourPerKg = chosen.map(m => m.our_price_per_kg).find(v => v != null)
    const perKg = chosen.map(m => m.price_per_kg).filter(v => v != null).map(Number)

    const a = ourPerKg != null && perKg.length === chosen.length
      ? advise(Number(ourPerKg), perKg, t)
      : advise(
          Number(product.price ?? 0),
          chosen.map(m => Number(m.normalized_price ?? m.price)), t)

    if (a.verdict === 'expensive') report.expensive++
    else if (a.verdict === 'cheap') report.cheap++
    else if (a.verdict === 'aligned') report.aligned++
    else if (pending) report.needsReview++

    if (a.gapUah != null && a.verdict !== 'aligned' && a.verdict !== 'no_data') {
      report.worst.push({ name: product.name, gapUah: a.gapUah })
    }
  }

  report.worst.sort((x, y) => Math.abs(y.gapUah) - Math.abs(x.gapUah))
  report.worst = report.worst.slice(0, 3)
  return report
}

/** Sends it to the roles that are supposed to act on it. */
export async function sendReport(service: Service, report: Report) {
  const { data: settings } = await service
    .from('price_settings').select('report_recipients').eq('id', true).single()

  const roles = (settings?.report_recipients as string[] | null)
    ?? ['super_admin', 'admin', 'manager']

  const { data: people } = await service
    .from('profiles').select('id').eq('is_active', true).in('role', roles)

  if (!people?.length) return 0

  // Nothing to act on means no notice. A daily "all fine" trains people to
  // dismiss the one morning it is not.
  const actionable = report.expensive + report.cheap + report.needsReview
  if (!actionable) return 0

  const parts: string[] = []
  if (report.expensive) parts.push(`${report.expensive} дорожчих за ринок`)
  if (report.cheap) parts.push(`${report.cheap} із запасом підняти`)
  if (report.needsReview) parts.push(`${report.needsReview} чекають підтвердження`)

  const worst = report.worst
    .map(w => `${w.name} — ${w.gapUah > 0 ? '+' : ''}${Math.round(w.gapUah)} ₴`)
    .join('; ')

  await service.from('notifications').insert(people.map(p => ({
    user_id: p.id,
    type: 'price_report',
    title: `Моніторинг цін: ${parts.join(', ')}`,
    body: worst ? `Найбільші розриви: ${worst}` : null,
    link: '/analytics/prices',
  })))

  return people.length
}

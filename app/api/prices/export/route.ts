export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor } from '@/lib/order-events'
import { getCurrentRole, canAccess } from '@/lib/getRole'
import {
  advise, MATCH_MODES, VERDICT_META, DEFAULT_THRESHOLDS,
  isMatchMode, type Thresholds,
} from '@/lib/price-monitor'

/**
 * Порівняння як таблиця.
 *
 * Один аркуш, побудований так само, як читається сторінка: товар, під ним
 * рекомендація, під нею конкуренти й у кожного його позиції. Дві окремі
 * таблиці — зведення й деталі — змушували зіставляти їх очима, а це те саме,
 * від чого моніторинг мав би позбавити.
 */
export async function GET() {
  if (!await currentActor()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canAccess('priceMonitor', await getCurrentRole())) {
    return NextResponse.json({ error: 'Немає доступу' }, { status: 403 })
  }

  const service = createServiceClient()
  const [{ data: settings }, { data: competitors }, { data: watches }, { data: matches }] =
    await Promise.all([
      service.from('price_settings').select('*').eq('id', true).single(),
      service.from('price_competitors').select('id, name, city_path'),
      service.from('price_watches')
        .select('product_id, match_mode, product:products(id, name, price, category_name)'),
      service.from('price_matches')
        .select(`product_id, competitor_id, competitor_title, competitor_url, price,
                 price_per_kg, our_price_per_kg, similarity, status, is_chosen,
                 is_manual, context_label, checked_at`),
    ])

  const t: Thresholds = settings ? {
    minAbs: Number(settings.min_abs_uah), minPct: Number(settings.min_pct),
    undercutPct: Number(settings.undercut_pct),
  } : DEFAULT_THRESHOLDS

  const nameOf = new Map((competitors ?? []).map(c => [c.id as string, c.name as string]))
  const rows: Record<string, unknown>[] = []

  const blank = () => rows.push({})

  for (const w of watches ?? []) {
    const product = w.product as unknown as
      { name: string; price: number | null; category_name: string | null } | null
    if (!product) continue

    const mode = isMatchMode(w.match_mode) ? w.match_mode : 'similar'
    const mine = (matches ?? []).filter(m => m.product_id === w.product_id)

    // Та сама вибірка, що й на сторінці: обрана позиція, інакше найсхожіша
    const perCompetitor = new Map<string, typeof mine[number]>()
    for (const m of mine) {
      if (m.price == null) continue
      const held = perCompetitor.get(m.competitor_id as string)
      if (m.is_chosen) { perCompetitor.set(m.competitor_id as string, m); continue }
      if (held?.is_chosen) continue
      if (Number(m.similarity ?? 0) < MATCH_MODES[mode].trusted) continue
      if (!held || Number(m.similarity ?? 0) > Number(held.similarity ?? 0)) {
        perCompetitor.set(m.competitor_id as string, m)
      }
    }

    const our = Number(mine.find(m => m.our_price_per_kg != null)?.our_price_per_kg
      ?? product.price ?? 0)
    const a = advise(our, [...perCompetitor.values()]
      .map(m => Number(m.price_per_kg ?? m.price)), t)

    rows.push({
      'Товар / конкурент / позиція': product.name,
      'Наша, ₴/кг': our || '',
      'Ціна, ₴/кг': '',
      'Різниця, ₴': '',
      'Оцінка': VERDICT_META[a.verdict].label,
      'Рекомендація': a.suggested
        ? `${a.reason}. Рекомендована ціна ${a.suggested} ₴/кг`
        : a.reason,
      'Збіг, %': '',
      'Стан': MATCH_MODES[mode].label,
      'Посилання': '',
    })

    for (const [competitorId, used] of perCompetitor) {
      const offers = mine
        .filter(m => m.competitor_id === competitorId && m.price != null)
        .sort((x, y) => (y.is_chosen ? 1 : 0) - (x.is_chosen ? 1 : 0)
          || Number(y.similarity ?? 0) - Number(x.similarity ?? 0))

      const theirs = Number(used.price_per_kg ?? used.price)
      rows.push({
        'Товар / конкурент / позиція': `  ${nameOf.get(competitorId) ?? ''}`,
        'Наша, ₴/кг': '',
        'Ціна, ₴/кг': Math.round(theirs),
        'Різниця, ₴': our ? Math.round(theirs - our) : '',
        'Оцінка': '',
        'Рекомендація': '',
        'Збіг, %': '',
        'Стан': '',
        'Посилання': '',
      })

      for (const m of offers) {
        rows.push({
          'Товар / конкурент / позиція': `      ${m.competitor_title ?? ''}`,
          'Наша, ₴/кг': '',
          'Ціна, ₴/кг': m.price_per_kg != null ? Math.round(Number(m.price_per_kg)) : '',
          'Різниця, ₴': '',
          'Оцінка': '',
          'Рекомендація': m.context_label ?? '',
          'Збіг, %': m.similarity != null ? Math.round(Number(m.similarity) * 100) : '',
          'Стан': m.is_chosen ? 'порівнюємо з цією'
            : m.is_manual ? 'внесено вручну'
            : m.status === 'confirmed' ? 'стежимо за ціною' : '',
          'Посилання': String(m.competitor_url ?? '').startsWith('http') ? m.competitor_url : '',
        })
      }
    }

    // Конкуренти, у яких нічого не знайшлось — теж факт, і його треба бачити
    for (const c of competitors ?? []) {
      if (perCompetitor.has(c.id as string)) continue
      rows.push({
        'Товар / конкурент / позиція': `  ${c.name}`,
        'Наша, ₴/кг': '', 'Ціна, ₴/кг': '', 'Різниця, ₴': '',
        'Оцінка': '', 'Рекомендація': 'збігу не знайдено', 'Збіг, %': '',
        'Стан': '', 'Посилання': '',
      })
    }

    blank()
  }

  const sheet = XLSX.utils.json_to_sheet(rows)
  sheet['!cols'] = [
    { wch: 60 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 },
    { wch: 52 }, { wch: 9 }, { wch: 20 }, { wch: 60 },
  ]
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Моніторинг цін')

  const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  const stamp = new Date().toISOString().slice(0, 10)

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="monitoring-cin-${stamp}.xlsx"`,
    },
  })
}

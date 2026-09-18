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
 * The comparison as a spreadsheet.
 *
 * Built from the same stored rows the page reads, and run through the same
 * advise() — a report that recomputed its own verdicts would eventually
 * disagree with the screen it was exported from.
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
                 normalized_price, similarity, status, checked_at`),
    ])

  const t: Thresholds = settings ? {
    minAbs: Number(settings.min_abs_uah), minPct: Number(settings.min_pct),
    undercutPct: Number(settings.undercut_pct),
  } : DEFAULT_THRESHOLDS

  const nameOf = new Map((competitors ?? []).map(c => [c.id as string, c.name as string]))
  const byProduct = new Map<string, typeof matches>()
  for (const m of matches ?? []) {
    byProduct.set(m.product_id as string, [...(byProduct.get(m.product_id as string) ?? []), m])
  }

  const summary: Record<string, unknown>[] = []
  const detail: Record<string, unknown>[] = []

  for (const w of watches ?? []) {
    const product = w.product as unknown as
      { name: string; price: number | null; category_name: string | null } | null
    if (!product) continue

    const mode = isMatchMode(w.match_mode) ? w.match_mode : 'similar'
    const all = byProduct.get(w.product_id as string) ?? []
    const used = all.filter(m => m.status !== 'rejected' && m.price != null
      && (m.status === 'confirmed' || Number(m.similarity ?? 0) >= MATCH_MODES[mode].trusted))

    const our = Number(product.price ?? 0)
    const a = advise(our, used.map(m => Number(m.normalized_price ?? m.price)), t)

    summary.push({
      'Товар': product.name,
      'Категорія': product.category_name ?? '',
      'Наша ціна, ₴': our || '',
      'Найдешевший конкурент, ₴': a.cheapest ?? '',
      'Середня по ринку, ₴': a.average != null ? Math.round(a.average) : '',
      'Різниця, ₴': a.gapUah != null ? Math.round(a.gapUah) : '',
      'Різниця, %': a.gapPct != null ? Number(a.gapPct.toFixed(1)) : '',
      'Оцінка': VERDICT_META[a.verdict].label,
      'Рекомендована ціна, ₴': a.suggested ?? '',
      'Що зробити': a.reason,
      'Ступінь схожості': MATCH_MODES[mode].label,
      'Конкурентів враховано': used.length,
    })

    for (const m of all) {
      detail.push({
        'Товар': product.name,
        'Наша ціна, ₴': our || '',
        'Конкурент': nameOf.get(m.competitor_id as string) ?? '',
        'Позиція конкурента': m.competitor_title ?? '',
        'Ціна конкурента, ₴': m.price != null ? Number(m.price) : '',
        'Зведена до нашої пачки, ₴': m.normalized_price != null ? Number(m.normalized_price) : '',
        'Збіг назв, %': m.similarity != null ? Math.round(Number(m.similarity) * 100) : '',
        'Статус': m.status === 'confirmed' ? 'Підтверджено'
          : m.status === 'rejected' ? 'Відхилено' : 'Автоматично',
        'Посилання': m.competitor_url ?? '',
        'Перевірено': m.checked_at
          ? new Date(m.checked_at as string).toLocaleString('uk-UA') : '',
      })
    }
  }

  const book = XLSX.utils.book_new()

  const overview = XLSX.utils.json_to_sheet(summary)
  // Widths set by hand: a product name in a default-width column is unreadable,
  // and a report nobody can read is not a report
  overview['!cols'] = [
    { wch: 46 }, { wch: 22 }, { wch: 13 }, { wch: 22 }, { wch: 18 },
    { wch: 12 }, { wch: 11 }, { wch: 14 }, { wch: 20 }, { wch: 40 },
    { wch: 18 }, { wch: 20 },
  ]
  XLSX.utils.book_append_sheet(book, overview, 'Огляд')

  const rows = XLSX.utils.json_to_sheet(detail)
  rows['!cols'] = [
    { wch: 46 }, { wch: 13 }, { wch: 22 }, { wch: 46 }, { wch: 18 },
    { wch: 24 }, { wch: 13 }, { wch: 15 }, { wch: 60 }, { wch: 18 },
  ]
  XLSX.utils.book_append_sheet(book, rows, 'Деталі по конкурентах')

  const params = XLSX.utils.json_to_sheet([
    { 'Параметр': 'Поріг у гривнях', 'Значення': t.minAbs },
    { 'Параметр': 'Поріг у відсотках', 'Значення': t.minPct },
    { 'Параметр': 'Наскільки підрізати найдешевшого, %', 'Значення': t.undercutPct },
    { 'Параметр': 'Сформовано', 'Значення': new Date().toLocaleString('uk-UA') },
    ...(competitors ?? []).map(c => ({
      'Параметр': `Конкурент: ${c.name}`,
      'Значення': c.city_path ? `місто ${c.city_path}` : 'місто за замовчуванням сайту',
    })),
  ])
  params['!cols'] = [{ wch: 40 }, { wch: 40 }]
  XLSX.utils.book_append_sheet(book, params, 'Параметри')

  const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  const stamp = new Date().toISOString().slice(0, 10)

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="monitoring-cin-${stamp}.xlsx"`,
    },
  })
}

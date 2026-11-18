/**
 * Чи лишилась у маркетплейсній угоді наша націнка.
 *
 * Замовлення з майданчика йде в Бітрікс за категорією «Маркетплейс» —
 * онлайнова ціна, помножена на коефіцієнт. Але рядок в угоді живе далі
 * без нас: у 1С позицію замінюють, коли фасовка не та або товару немає,
 * і заміна приходить із власною ціною картки 1С — без коефіцієнта.
 *
 * Саме так М16 за 16 листопада віддав шашлик по 345 замість 407,10:
 * товар на сайті вказував на п'ятикілограмову номенклатуру, покупець
 * узяв кілограмову пачку, комірник підмінив рядок — і націнка зникла
 * разом зі старим рядком. Побачив це Тарас, через день, очима.
 *
 * Тут ми дивимось самі: беремо живі маркетплейсні угоди й порівнюємо
 * ціну кожного рядка з тією, яка мала б там стояти.
 */
import { marketNumberLabel } from '@/lib/order-source'
import { createServiceClient } from '@/lib/supabase/service'
import { bitrix } from '@/lib/bitrix'
import { CLOSED_STAGES } from '@/lib/bitrix-stages'
import type { Check } from '@/lib/system-health'

type Service = ReturnType<typeof createServiceClient>

export interface DealRow {
  PRODUCT_ID: number | string
  PRODUCT_NAME: string
  PRICE: number | string
  QUANTITY: number | string
}

/**
 * Пакування й тара — не наш товар.
 *
 * Термопакет і термобокс дописує комірник у 1С, і ціна в них завжди
 * своя, з картки. Рахувати це за втрачену націнку означало б світити
 * червоним у кожній другій угоді — а перевірка, яка кричить щодня,
 * перестає щось значити.
 */
const SERVICE_ITEM = /термопакет|термобокс|кульк|пакет|пакув/i

export const isServiceItem = (name: string) => SERVICE_ITEM.test(name ?? '')

/** Копійчані розбіжності — не розбіжності: коефіцієнт і крок дають хвіст */
const TOLERANCE = 0.011

/**
 * Рядки, які втратили націнку.
 *
 * `expected` віддає ціну, яка мала б стояти; `null` означає «не знаємо
 * базової ціни» — такий рядок мовчить, бо звинувачувати можна лише тоді,
 * коли є з чим порівняти.
 */
export function underpriced(
  rows: DealRow[],
  expected: (row: DealRow) => number | null,
): DealRow[] {
  return rows.filter(row => {
    if (isServiceItem(row.PRODUCT_NAME)) return false
    const want = expected(row)
    if (want == null || !(want > 0)) return false
    return Number(row.PRICE) < want - TOLERANCE
  })
}

/** Позиції одразу для багатьох угод — пачкою, як і решта наших проходів */
async function productRows(dealIds: number[]): Promise<Map<number, DealRow[]>> {
  const out = new Map<number, DealRow[]>()

  for (let i = 0; i < dealIds.length; i += 50) {
    const chunk = dealIds.slice(i, i + 50)
    const cmd: Record<string, string> = {}
    for (const id of chunk) cmd[`d${id}`] = `crm.deal.productrows.get?id=${id}`

    const res = await bitrix<{
      result: Record<string, DealRow[]>
      result_error?: Record<string, unknown>
    }>('batch', { halt: 0, cmd })

    /* Угоду, про яку не сказали, просто не згадуємо: мовчання Бітрікса —
       не доказ того, що в ній щось не так */
    for (const id of chunk) {
      const rows = res?.result?.[`d${id}`]
      if (Array.isArray(rows) && !res?.result_error?.[`d${id}`]) out.set(id, rows)
    }
  }
  return out
}

/** Скільки днів назад дивимось: старіше вже не виправити накладною */
const DAYS = 14

export async function marketplacePriceCheck(service: Service): Promise<Check | null> {
  const { data: category } = await service
    .from('price_categories')
    .select('multiplier, rounding, rounding_step')
    .eq('name', 'Маркетплейс')
    .maybeSingle()

  if (!category) return null

  const multiplier = Number(category.multiplier ?? 1)
  const step = Number(category.rounding_step ?? 1) || 1
  const mode = String(category.rounding ?? 'none')

  const round = (value: number) => {
    if (mode === 'none' || !(value > 0)) return Math.round(value * 100) / 100
    const units = value / step
    const whole = mode === 'up' ? Math.ceil(Number(units.toFixed(6)))
      : mode === 'down' ? Math.floor(Number(units.toFixed(6)))
        : Math.round(units)
    return Math.round(whole * step * 100) / 100
  }

  const since = new Date(Date.now() - DAYS * 86_400_000).toISOString()
  const { data: orders } = await service
    .from('orders')
    .select('id, external_id, market_number, platform, bitrix_deal_id')
    .not('platform', 'in', '("site","manual")')
    .not('bitrix_deal_id', 'is', null)
    .gte('created_at', since)
    .not('status', 'in', `(${CLOSED_STAGES.map(s => `"${s}"`).join(',')})`)
    .limit(200)

  if (!orders?.length) return null

  const rowsByDeal = await productRows(
    orders.map(o => Number(o.bitrix_deal_id)).filter(Boolean),
  )
  if (!rowsByDeal.size) return null

  /* Номенклатура → наша базова ціна: артикул 1С знає і наш каталог, і
     каталог Бітрікса, і другий рятує там, де товару на сайті немає */
  const ids = [...new Set([...rowsByDeal.values()].flat().map(r => Number(r.PRODUCT_ID)))]
    .filter(Boolean)

  const { data: bitrixProducts } = await service
    .from('bitrix_products').select('product_id, uid_1c, price').in('product_id', ids)

  const uidByBitrix = new Map<number, string>()
  const bxPrice = new Map<number, number>()
  for (const p of bitrixProducts ?? []) {
    if (p.uid_1c) uidByBitrix.set(Number(p.product_id), p.uid_1c as string)
    if (p.price != null) bxPrice.set(Number(p.product_id), Number(p.price))
  }

  const uids = [...new Set(uidByBitrix.values())]
  const { data: ourProducts } = uids.length
    ? await service.from('products').select('uid_1c, price').in('uid_1c', uids)
    : { data: [] as { uid_1c: string; price: number | null }[] }

  const ourPrice = new Map<string, number>()
  for (const p of ourProducts ?? []) {
    if (p.price != null) ourPrice.set(p.uid_1c as string, Number(p.price))
  }

  const expected = (row: DealRow) => {
    const id = Number(row.PRODUCT_ID)
    const uid = uidByBitrix.get(id)
    const base = (uid ? ourPrice.get(uid) : undefined) ?? bxPrice.get(id)
    return base && base > 0 ? round(base * multiplier) : null
  }

  const hit: string[] = []
  for (const order of orders) {
    const rows = rowsByDeal.get(Number(order.bitrix_deal_id))
    if (!rows?.length) continue
    if (underpriced(rows, expected).length) {
      // Мітка та сама, що всюди: P для Prom, R для Rozetka, M для MauDau
      hit.push(marketNumberLabel(order.platform, order.market_number)
        ?? (order.external_id ?? '—'))
    }
  }

  if (!hit.length) return null

  return {
    key: 'mp-underpriced',
    label: 'Маркетплейс: в угоді ціна нижча за категорійну',
    why: 'рядок переписали в 1С, і він пішов у накладну без націнки',
    count: hit.length,
    sample: hit.slice(0, 6),
    severity: 'warn',
    href: '/orders/marketplaces',
  }
}

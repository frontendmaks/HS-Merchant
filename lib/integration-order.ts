/**
 * Замовлення так, як його бачить зовнішня система.
 *
 * Одна форма для всіх маршрутів і для вебхуків: якщо Бітрікс отримує різні
 * форми того самого замовлення залежно від того, звідки воно прийшло, він
 * неодмінно напише два різні обробники, і один із них відстане.
 *
 * Ціни тут — маркетплейсу, а не наші. Покупець погодився на те, що побачив, і
 * саме з цією сумою мають збігатись і комісія, і оголошена цінність накладної.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { effectiveQty, orderTotals, type OrderLine } from '@/lib/order-items'
import { ensureLines, loadCatalog } from '@/lib/order-lines'
import { buildResolver, type MatchBy } from '@/lib/integration-nomenclature'
import { canRecordPicking, canTogglePaid, requiresPayment } from '@/lib/order-statuses'

type Service = ReturnType<typeof createServiceClient>

export const ORDER_FIELDS = `
  id, external_id, platform, order_date, status, status_raw,
  customer_name, customer_phone, address, branch,
  total, commission, weight, seats_amount,
  ttn, np_ttn_ref, ttn_created_at,
  cancel_reason, customer_comment, operator_comment,
  is_paid, paid_at, created_at, updated_at, raw
`

const ITEM_FIELDS = `
  id, order_id, position, title, unit, unit_weight,
  product_external_id, product_id,
  marketplace_item_id, marketplace_unit_price, marketplace_qty, ordered_total,
  price_per_unit, ordered_qty, actual_qty, removed, source,
  created_at, updated_at
`

const MARKETPLACE_NAMES: Record<string, string> = {
  maudau: 'MauDau',
  rozetka: 'Rozetka',
}

export interface ApiOrderItem {
  id: string
  position: number
  /** Назва так, як її бачить покупець на маркетплейсі */
  title: string
  nomenclature: {
    uid_1c: string | null
    code_1c: string | null
    sku: string | null
    /** Назва з нашого каталогу — ближча до 1С, ніж назва маркетплейсу */
    catalog_name: string | null
    merchant_product_id: string | null
    /** Як знайдено товар: product_id | external_id | sku | sku+title | null */
    match_by: MatchBy
    /** Артикул спільний на кілька позицій 1С — варто звірити */
    ambiguous: boolean
  }
  unit: string
  unit_weight: number
  price_per_unit: number
  ordered_qty: number
  /**
   * Скільки зібрано фактично, в одиниці рядка — кілограми для вагового
   * товару, штуки для штучного. null — ще не комплектували.
   */
  actual_qty: number | null
  removed: boolean
  line_total: number
  /** Як позицію прислав маркетплейс — до будь-яких наших правок */
  marketplace: {
    item_id: string | null
    unit_price: number | null
    quantity: number | null
    total: number | null
  }
  /** marketplace — рядок із замовлення; manual — доданий оператором */
  source: string
  updated_at: string | null
}

export interface ApiOrder {
  id: string
  /** Номер маркетплейсу: MD-… або RZ-… */
  external_id: string
  source: {
    platform: string
    marketplace: string
    /** Номер у самого маркетплейсу, без нашого префікса */
    marketplace_order_id: string
    /** Статус словами маркетплейсу, до нашого перекладу */
    status_raw: string | null
  }
  order_date: string | null
  status: string | null
  /** Що з цим замовленням можна робити просто зараз */
  can: {
    record_picking: boolean
    change_payment: boolean
  }
  payment: {
    is_paid: boolean
    paid_at: string | null
    /** Статуси доставки вимагають оплати */
    required_for_shipping: boolean
  }
  customer: { name: string | null; phone: string | null }
  delivery: {
    /** branch — відділення, courier — адреса, unknown — не вказано */
    method: 'branch' | 'courier' | 'unknown'
    branch: string | null
    address: string | null
    ttn: string | null
    ttn_created_at: string | null
    weight_kg: number | null
    seats: number
  }
  money: {
    /** Поточна сума: з фактичними кількостями, якщо комплектація вже була */
    total: number
    /** Сума, на яку оформив замовлення покупець */
    ordered_total: number
    /** Різниця після комплектації; від'ємна — зібрали менше */
    diff: number
    commission: number
    currency: 'UAH'
  }
  comments: {
    customer: string | null
    operator: string | null
    cancel_reason: string | null
  }
  items: ApiOrderItem[]
  created_at: string | null
  updated_at: string | null
}

/** Номер у маркетплейсу без нашого префікса — саме його знає їхня підтримка. */
const stripPrefix = (externalId: string) => externalId.replace(/^(MD|RZ)-/, '')

export async function buildOrders(
  service: Service,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  orders: any[],
): Promise<ApiOrder[]> {
  if (!orders.length) return []

  const ids = orders.map(o => o.id as string)

  // Створюємо рядки тим замовленням, яких ще ніхто не відкривав: інакше
  // зовнішня система побачила б замовлення без товарів і вирішила, що воно
  // порожнє. Довідник вантажиться один на всю вибірку.
  const { data: have } = await service
    .from('order_items').select('order_id').in('order_id', ids)
  const haveLines = new Set((have ?? []).map(r => r.order_id as string))
  const missing = ids.filter(id => !haveLines.has(id))

  if (missing.length) {
    const catalog = await loadCatalog(service)
    for (const id of missing) await ensureLines(service, id, catalog)
  }

  const { data: items } = await service
    .from('order_items').select(ITEM_FIELDS).in('order_id', ids).order('position')

  const resolver = await buildResolver(service, (items ?? []) as never)

  const byOrder = new Map<string, typeof items>()
  for (const i of items ?? []) {
    const key = (i as unknown as { order_id: string }).order_id
    byOrder.set(key, [...(byOrder.get(key) ?? []), i])
  }

  return orders.map(o => {
    const raw = (byOrder.get(o.id) ?? [])
    const totals = orderTotals(raw as unknown as OrderLine[])

    const lines: ApiOrderItem[] = raw.map(i => {
      const found = resolver.resolve(i as never)
      const p = found.product
      const qty = effectiveQty(i as never)
      return {
        id: i.id as string,
        position: i.position as number,
        title: i.title as string,
        nomenclature: {
          uid_1c: p?.uid_1c ?? null,
          code_1c: p?.code_1c ?? null,
          sku: p?.sku ?? null,
          catalog_name: p?.name ?? null,
          merchant_product_id: p?.id ?? null,
          match_by: found.match_by,
          ambiguous: found.ambiguous,
        },
        unit: i.unit as string,
        unit_weight: Number(i.unit_weight ?? 0),
        price_per_unit: Number(i.price_per_unit ?? 0),
        ordered_qty: Number(i.ordered_qty ?? 0),
        // У базі це пачки; назовні — одиниця товару, як і ordered_qty
        actual_qty: i.actual_qty == null ? null : qty,
        removed: !!i.removed,
        line_total: i.removed ? 0 : Math.round(qty * Number(i.price_per_unit ?? 0) * 100) / 100,
        marketplace: {
          item_id: (i.marketplace_item_id as string) ?? null,
          unit_price: i.marketplace_unit_price == null ? null : Number(i.marketplace_unit_price),
          quantity: i.marketplace_qty == null ? null : Number(i.marketplace_qty),
          total: i.ordered_total == null ? null : Number(i.ordered_total),
        },
        source: i.source as string,
        updated_at: i.updated_at as string,
      }
    })

    return {
      id: o.id,
      external_id: o.external_id,
      source: {
        platform: o.platform,
        marketplace: MARKETPLACE_NAMES[o.platform] ?? o.platform,
        marketplace_order_id: stripPrefix(o.external_id),
        status_raw: o.status_raw ?? null,
      },
      order_date: o.order_date,
      status: o.status,
      can: {
        record_picking: canRecordPicking(o.status, o.ttn),
        change_payment: canTogglePaid(o.status),
      },
      payment: {
        is_paid: !!o.is_paid,
        paid_at: o.paid_at ?? null,
        required_for_shipping: true,
      },
      customer: { name: o.customer_name, phone: o.customer_phone },
      delivery: {
        method: o.branch ? 'branch' : o.address ? 'courier' : 'unknown',
        branch: o.branch,
        address: o.address,
        ttn: o.ttn,
        ttn_created_at: o.ttn_created_at ?? null,
        weight_kg: o.weight == null ? null : Number(o.weight),
        seats: Number(o.seats_amount ?? 1),
      },
      money: {
        total: Number(o.total ?? 0),
        ordered_total: totals.ordered,
        diff: totals.diff,
        commission: Number(o.commission ?? 0),
        currency: 'UAH' as const,
      },
      comments: {
        customer: o.customer_comment,
        operator: o.operator_comment,
        cancel_reason: o.cancel_reason,
      },
      items: lines,
      created_at: o.created_at,
      updated_at: o.updated_at,
    }
  })
}

/** Чи вимагає цей статус оплати — для довідки у відповіді. */
export { requiresPayment }

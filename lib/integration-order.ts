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
import { effectiveQty } from '@/lib/order-items'

type Service = ReturnType<typeof createServiceClient>

export const ORDER_FIELDS = `
  id, external_id, platform, order_date, status, status_raw,
  customer_name, customer_phone, address, branch,
  total, commission, weight, seats_amount,
  ttn, np_ttn_ref, ttn_created_at,
  cancel_reason, customer_comment, operator_comment,
  is_paid, paid_at, created_at, updated_at
`

const ITEM_FIELDS = `
  id, position, title, unit, unit_weight,
  product_external_id, product_id,
  marketplace_unit_price, marketplace_qty,
  price_per_unit, ordered_qty, actual_qty, removed,
  updated_at
`

export interface ApiOrder {
  id: string
  external_id: string
  platform: string
  order_date: string | null
  status: string | null
  is_paid: boolean
  customer: { name: string | null; phone: string | null }
  delivery: { address: string | null; branch: string | null; ttn: string | null }
  money: { total: number; commission: number; currency: 'UAH' }
  comments: { customer: string | null; operator: string | null }
  items: ApiOrderItem[]
  updated_at: string | null
}

export interface ApiOrderItem {
  id: string
  position: number
  /** Назва так, як її бачить покупець на маркетплейсі */
  title: string
  /** Номенклатура 1С — за цим зіставляє Бітрікс */
  nomenclature: {
    uid_1c: string | null
    code_1c: string | null
    sku: string | null
    /** Назва з нашого каталогу, ближча до 1С за назву маркетплейсу */
    catalog_name: string | null
  }
  unit: string
  unit_weight: number
  price_per_unit: number
  ordered_qty: number
  /** Скільки зібрано фактично. null — ще не комплектували. */
  actual_qty: number | null
  removed: boolean
  /** Сума за цією позицією з урахуванням фактичної кількості */
  line_total: number
}

/**
 * Збирає замовлення у зовнішню форму.
 *
 * Номенклатура підтягується з каталогу: у рядку замовлення зберігається назва
 * маркетплейсу, а 1С знає товар за uid і кодом. Без цього зіставлення лягло б
 * на зіставлення назв — тобто на здогад.
 */
export async function buildOrders(
  service: Service,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  orders: any[],
): Promise<ApiOrder[]> {
  if (!orders.length) return []

  const ids = orders.map(o => o.id as string)
  const { data: items } = await service
    .from('order_items').select(ITEM_FIELDS).in('order_id', ids).order('position')

  const externalIds = [...new Set(
    (items ?? []).map(i => i.product_external_id).filter(Boolean) as string[])]

  const { data: products } = externalIds.length
    ? await service.from('products')
        .select('external_id, name, sku, uid_1c, code_1c')
        .in('external_id', externalIds)
    : { data: [] }

  const catalog = new Map((products ?? []).map(p => [p.external_id as string, p]))
  const byOrder = new Map<string, typeof items>()
  for (const i of items ?? []) {
    const key = (i as unknown as { order_id: string }).order_id
    byOrder.set(key, [...(byOrder.get(key) ?? []), i])
  }

  return orders.map(o => {
    const lines = (byOrder.get(o.id) ?? []).map(i => {
      const p = i.product_external_id ? catalog.get(i.product_external_id) : null
      const qty = effectiveQty(i as never)
      return {
        id: i.id as string,
        position: i.position as number,
        title: i.title as string,
        nomenclature: {
          uid_1c: (p?.uid_1c as string) ?? null,
          code_1c: (p?.code_1c as string) ?? null,
          sku: (p?.sku as string) ?? null,
          catalog_name: (p?.name as string) ?? null,
        },
        unit: i.unit as string,
        unit_weight: Number(i.unit_weight ?? 0),
        price_per_unit: Number(i.price_per_unit ?? 0),
        ordered_qty: Number(i.ordered_qty ?? 0),
        actual_qty: i.actual_qty == null ? null : Number(i.actual_qty),
        removed: !!i.removed,
        line_total: i.removed ? 0 : Math.round(qty * Number(i.price_per_unit ?? 0) * 100) / 100,
      }
    })

    return {
      id: o.id,
      external_id: o.external_id,
      platform: o.platform,
      order_date: o.order_date,
      status: o.status,
      is_paid: !!o.is_paid,
      customer: { name: o.customer_name, phone: o.customer_phone },
      delivery: { address: o.address, branch: o.branch, ttn: o.ttn },
      money: {
        total: Number(o.total ?? 0),
        commission: Number(o.commission ?? 0),
        currency: 'UAH' as const,
      },
      comments: { customer: o.customer_comment, operator: o.operator_comment },
      items: lines,
      updated_at: o.updated_at,
    }
  })
}

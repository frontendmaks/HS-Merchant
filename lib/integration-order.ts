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
import { effectiveQty, foldSku } from '@/lib/order-items'
import { ensureLines, loadCatalog } from '@/lib/order-lines'

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
  id, order_id, position, title, unit, unit_weight,
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

  // Створюємо рядки тим замовленням, яких ще ніхто не відкривав: інакше
  // зовнішня система побачила б замовлення без товарів і вирішила, що воно
  // порожнє
  const { data: have } = await service
    .from('order_items').select('order_id').in('order_id', ids)
  const haveLines = new Set((have ?? []).map(r => r.order_id as string))

  const missing = ids.filter(id => !haveLines.has(id))
  if (missing.length) {
    // Довідник один на всю вибірку
    const catalog = await loadCatalog(service)
    for (const id of missing) await ensureLines(service, id, catalog)
  }

  const { data: items } = await service
    .from('order_items').select(ITEM_FIELDS).in('order_id', ids).order('position')

  /**
   * Товар у рядку впізнається трьома способами, і всі три потрібні.
   *
   * `product_id` — справжній зв'язок, але він є не скрізь. У
   * `product_external_id` лежить то ідентифікатор сайту («883215»), то
   * артикул («K0209») — залежно від того, що прислав маркетплейс. Зіставлення
   * лише за одним із них залишало чотири рядки з шести без номенклатури 1С,
   * тобто невидимими для Бітрікса.
   */
  const productIds = [...new Set(
    (items ?? []).map(i => i.product_id).filter(Boolean) as string[])]
  const refs = [...new Set(
    (items ?? []).map(i => i.product_external_id).filter(Boolean) as string[])]

  const [{ data: byId }, { data: byRef }] = await Promise.all([
    productIds.length
      ? service.from('products')
          .select('id, external_id, sku, name, uid_1c, code_1c').in('id', productIds)
      : Promise.resolve({ data: [] as never[] }),
    refs.length
      ? service.from('products')
          .select('id, external_id, sku, name, uid_1c, code_1c')
          .or(`external_id.in.(${refs.join(',')}),sku.in.(${refs.join(',')})`)
      : Promise.resolve({ data: [] as never[] }),
  ])

  type Row = { id: string; external_id: string | null; sku: string | null
               name: string | null; uid_1c: string | null; code_1c: string | null }

  const byUuid = new Map<string, Row>()
  const byRefKey = new Map<string, Row>()
  for (const p of [...(byId ?? []), ...(byRef ?? [])] as Row[]) {
    byUuid.set(p.id, p)
    if (p.external_id) byRefKey.set(p.external_id, p)
    if (p.sku) byRefKey.set(foldSku(p.sku), p)
  }

  const resolve = (item: { product_id?: string | null; product_external_id?: string | null }) =>
    (item.product_id ? byUuid.get(item.product_id) : null)
    ?? (item.product_external_id
        ? byRefKey.get(item.product_external_id) ?? byRefKey.get(foldSku(item.product_external_id))
        : null)
    ?? null
  const byOrder = new Map<string, typeof items>()
  for (const i of items ?? []) {
    const key = (i as unknown as { order_id: string }).order_id
    byOrder.set(key, [...(byOrder.get(key) ?? []), i])
  }

  return orders.map(o => {
    const lines = (byOrder.get(o.id) ?? []).map(i => {
      const p = resolve(i)
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

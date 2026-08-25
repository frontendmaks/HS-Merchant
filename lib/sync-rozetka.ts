import { createServiceClient } from '@/lib/supabase/service'
import { notifyNewOrders } from '@/lib/order-notifications'
import { rozetkaToken, invalidateRozetkaToken, isTokenError } from '@/lib/rozetka-auth'

const BASE = process.env.ROZETKA_BASE!

const STATUS_MAP: Record<number, string> = {
  1: 'Нове',
  2: 'Комплектується',
  3: 'Передано в доставку',
  4: 'Доставляється',
  5: 'Чекає в пункті',
  6: 'Доставлено',
  7: 'Не оброблено',
  11: 'Скасовано',
  12: 'Скасовано',
  13: 'Скасовано',
  15: 'Скасовано',
  16: 'Скасовано',
  17: 'Скасовано',
  18: 'Скасовано',
  19: 'Скасовано',
  20: 'Комплектується',
  24: 'Скасовано',
  25: 'Скасовано',
  26: 'Опрацьовується',
  28: 'Скасовано',
  29: 'Скасовано',
  30: 'Скасовано',
  31: 'Скасовано',
  40: 'Скасовано',
  42: 'Скасовано',
  44: 'Скасовано',
  45: 'Скасовано',
  50: 'Скасовано',
  52: 'Нове',
  54: 'Нове',
  55: 'Очікує оплату',
  61: 'Доставляється',
}

const CANCELED_STATUSES = new Set([11,12,13,15,16,17,18,19,24,25,28,29,30,31,40,42,44,45,50])

// Rozetka encodes cancel reason in the numeric status ID itself
const ROZETKA_CANCEL_REASON_MAP: Record<number, string> = {
  11: 'Не прийшов',
  12: 'Відмова при отриманні',
  13: 'Скасовано',
  15: 'Скасовано',
  16: 'Немає в наявності',
  17: 'Не влаштовує оплата',
  18: 'Не вдалося зв\'язатися',
  19: 'Повернено',
  24: 'Скасовано',
  25: 'Скасовано',
  28: 'Скасовано',
  29: 'Скасовано',
  30: 'Скасовано',
  31: 'Скасовано',
  40: 'Клієнт передумав',
  42: 'Скасовано',
  44: 'Фейкове замовлення',
  45: 'Скасовано покупцем',
  50: 'Клієнт не оплатив',
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildAddress(delivery: any): string {
  if (!delivery) return ''
  const parts = [
    delivery.city?.city_name,
    delivery.delivery_service_name,
    delivery.place_street,
    delivery.place_house,
    delivery.place_number,
  ]
  return parts.filter(Boolean).join(', ')
}

/** Full branch label, e.g. "Нова Пошта: Відділення №7".
 *  delivery_service_name is "Нова Пошта" or "Нова Пошта (поштомати)" — the
 *  parenthetical marks the type, so move it into the label instead. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildBranch(delivery: any): string | null {
  if (!delivery) return null
  const service: string = delivery.delivery_service_name || ''
  const num: string = String(delivery.place_number ?? '').trim()
  // No pickup point — courier delivery to a street address
  if (!num) return service ? `${service}: Кур'єр` : "Кур'єр"
  const isPostomat = /поштомат/i.test(service)
  const provider = service.replace(/\s*\([^)]*\)\s*$/, '').trim()
  const label = `${isPostomat ? 'Поштомат' : 'Відділення'} №${num}`
  return provider ? `${provider}: ${label}` : label
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildItems(purchases: any[]): string {
  if (!purchases?.length) return ''
  return purchases
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((p: any) => `${p.item_name || ''}, ${p.quantity || 1} шт x ${p.price_with_discount || p.price || 0} грн`)
    .join('\n')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function orderToRow(order: any) {
  const statusNum = Number(order.status)
  const isCanceled = CANCELED_STATUSES.has(statusNum)

  let customerName = ''
  if (order.recipient_title?.full_name) {
    customerName = order.recipient_title.full_name
  } else {
    customerName = [
      order.recipient_title?.last_name,
      order.recipient_title?.first_name,
      order.recipient_title?.second_name,
    ]
      .filter(Boolean)
      .join(' ')
  }

  const commissionSum = isCanceled
    ? 0
    // Rozetka charges commission on the ORIGINAL (non-discounted) item price,
    // not the sale price. Formula: item.price * quantity * commission_percent / 100
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    : (order.purchases || []).reduce((s: number, p: any) => {
        const pct = Number(p.item?.commission_percent ?? 0) / 100
        const unitPrice = Number(p.item?.price ?? p.price ?? 0)
        const qty = Number(p.quantity ?? 1)
        return s + unitPrice * qty * pct
      }, 0)

  return {
    external_id: 'RZ-' + order.id,
    platform: 'rozetka',
    order_date: order.created ? order.created.split(' ')[0] : null,
    customer_name: customerName || null,
    customer_phone: order.delivery?.recipient_phone || order.user_phone || null,
    address: buildAddress(order.delivery),
    branch: buildBranch(order.delivery),
    items: buildItems(order.purchases || []),
    total: Number(order.cost_with_discount || order.cost || 0),
    commission: commissionSum,
    status: STATUS_MAP[statusNum] || String(order.status),
    status_raw: String(order.status),
    ttn: order.ttn || null,
    cancel_reason: isCanceled ? (ROZETKA_CANCEL_REASON_MAP[statusNum] ?? 'Скасовано') : null,
    raw: order,
    updated_at: new Date().toISOString(),
  }
}

async function fetchPages(dateParam: string): Promise<Map<string, ReturnType<typeof orderToRow>>> {
  const map = new Map<string, ReturnType<typeof orderToRow>>()
  let page = 1
  let pageCount = 1

  while (page <= pageCount) {
    const url = `${BASE}/orders/search?page=${page}&pageSize=50&sort=-id&types=1&expand=purchases,delivery&${dateParam}`

    // A token can expire mid-run, so one retry with a fresh one before giving up
    const get = async () => {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${await rozetkaToken()}` },
      })
      // Fail loudly. Swallowing this once let an expired token look like
      // "0 orders synced, success" for weeks.
      if (!res.ok) {
        throw new Error(`Rozetka API ${res.status} on page ${page}: ${(await res.text()).slice(0, 200)}`)
      }
      const body = await res.json()
      if (!body.success) {
        const e = body.errors
        throw new Error(
          `Rozetka API error${e?.code ? ` ${e.code}` : ''}: ${e?.description || e?.message || JSON.stringify(e).slice(0, 200)}`
        )
      }
      return body
    }

    let data
    try {
      data = await get()
    } catch (e) {
      if (!isTokenError(e)) throw e
      invalidateRozetkaToken()
      data = await get()
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orders: any[] = data.content?.orders || []
    pageCount = data.content?._meta?.pageCount || 1

    for (const o of orders) {
      map.set(String(o.id), orderToRow(o))
    }

    if (!orders.length) break
    page++
  }

  return map
}

/** See SyncMode in lib/sync-maudau.ts — same contract. */
export type SyncMode = 'full' | 'quick'

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export async function syncRozetka(mode: SyncMode = 'full'): Promise<{ synced: number }> {
  const supabase = createServiceClient()

  const now = new Date()
  const updatedFrom = ymd(new Date(now.getTime() - 24 * 60 * 60 * 1000))
  const yearStart = `${now.getFullYear()}-01-01`

  const updatedMap = await fetchPages(`updated_from=${updatedFrom}`)
  const createdMap = mode === 'full'
    ? await fetchPages(`created_from=${yearStart}`)
    : new Map<string, ReturnType<typeof orderToRow>>()

  // Merge: updatedMap wins
  const merged = new Map([...createdMap, ...updatedMap])
  const rows = Array.from(merged.values())

  if (rows.length > 0) {
    // One read serves two purposes: which orders we already know about (so the
    // rest can be announced), and their cancel_reason. Rozetka derives the
    // reason from the numeric status; for non-canceled orders we keep whatever
    // was set by hand.
    const externalIds = rows.map(r => r.external_id)
    const { data: existing } = await supabase
      .from('orders')
      .select('id, external_id, cancel_reason, status')
      .in('external_id', externalIds)
      .eq('platform', 'rozetka')

    const known = new Set((existing ?? []).map(r => r.external_id as string))
    const freshOrders = rows.filter(r => !known.has(r.external_id))

    const existingReasons = new Map(
      (existing ?? [])
        .filter(r => r.cancel_reason != null)
        .map(r => [r.external_id as string, r.cancel_reason as string])
    )

    const rowsToUpsert = rows.map(r => ({
      ...r,
      cancel_reason: r.cancel_reason ?? existingReasons.get(r.external_id) ?? null,
    }))

    const { error } = await supabase
      .from('orders')
      .upsert(rowsToUpsert, { onConflict: 'external_id,platform' })
    if (error) throw error

    // A status that moved on the marketplace side belongs in the journal too,
    // with no actor — nobody here touched it.
    const beforeById = new Map(
      (existing ?? []).map(r => [r.external_id as string, r as { id: string; status: string | null }])
    )
    const statusEvents = rows
      .map(r => {
        const prev = beforeById.get(r.external_id)
        if (!prev || prev.status === r.status) return null
        return {
          order_id: prev.id,
          actor_id: null,
          actor_name: null,
          type: 'sync_status',
          old_value: prev.status,
          new_value: r.status,
        }
      })
      .filter((e): e is NonNullable<typeof e> => e !== null)

    if (statusEvents.length) {
      await supabase.from('order_events').insert(statusEvents)
    }

    // Only after the rows are safely stored
    await notifyNewOrders(supabase, 'rozetka', freshOrders)
  }

  return { synced: rows.length }
}

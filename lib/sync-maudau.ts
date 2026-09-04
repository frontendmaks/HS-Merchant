import { createServiceClient } from '@/lib/supabase/service'
import { getMaudauJwt } from '@/lib/maudau'
import { notifyNewOrders } from '@/lib/order-notifications'
import { broadcastOrderChange } from '@/lib/order-broadcast'
import { hasWaybill } from '@/lib/order-statuses'
import { patchMaudauStatus } from '@/lib/maudau'

const BASE = process.env.MAUDAU_BASE!

const STATUS_MAP: Record<string, string> = {
  new_order: 'Нове',
  accepted: 'Прийнято',
  approved: 'Узгоджено',
  delivering: 'На доставці',
  arrived: 'Прибуло',
  completed: 'Доставлено',
  canceled: 'Скасовано',
}


// safely extract a string from a value that might be an object
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function str(val: any): string {
  if (!val) return ''
  if (typeof val === 'string') return val
  if (typeof val === 'number') return String(val)
  // Try known string keys first, then any string value in the object
  const known = val.description || val.name || val.title || val.address_text || val.address || val.text || val.value
  if (known && typeof known === 'string') return known
  // Fallback: find first string value
  for (const v of Object.values(val)) {
    if (typeof v === 'string' && v) return v
  }
  return ''
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildAddress(delivery_address: any): string {
  if (!delivery_address) return ''
  const city = str(delivery_address.city?.name ?? delivery_address.city)
  const warehouseRaw = delivery_address.warehouse?.address ?? delivery_address.warehouse
  const warehouse = str(warehouseRaw)
  if (warehouse) return [city, warehouse].filter(Boolean).join(', ')
  const street = str(delivery_address.street)
  const building = str(delivery_address.building)
  return [city, street, building].filter(Boolean).join(', ')
}

const PROVIDER_NAMES: Record<string, string> = {
  nova_poshta: 'Нова Пошта',
  ukrposhta: 'Укрпошта',
  meest: 'Meest',
}

/** Full branch label, e.g. "Нова Пошта: Відділення №7 (до 30 кг)".
 *  warehouse.name looks like "Відділення №7 (до 30 кг): вул. Академіка Шалімова, 67В"
 *  — everything before the first ":" is the branch itself. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildBranch(delivery_address: any): string | null {
  if (!delivery_address) return null
  const wh = delivery_address.warehouse
  const name = str(wh?.name)
  // No warehouse — courier delivery straight to a street address
  if (!name) {
    const provider = PROVIDER_NAMES[
      delivery_address.city?.external_ids?.[0]?.delivery_provider as string
    ]
    return provider ? `${provider}: Кур'єр` : "Кур'єр"
  }
  const label = name.split(':')[0].trim()
  if (!label) return null
  const provider = PROVIDER_NAMES[wh?.delivery_provider as string]
  return provider ? `${provider}: ${label}` : label
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildItems(parcels: any[]): string {
  if (!parcels?.length) return ''
  const lines: string[] = []
  for (const parcel of parcels) {
    for (const item of parcel.items || []) {
      const title = item.product?.title_uk || item.product?.title || ''
      const qty = item.quantity || 1
      const price = (item.price || 0) / 100
      lines.push(`${title}, ${qty} шт x ${price} грн`)
    }
  }
  return lines.join('\n')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function orderToRow(order: any) {
  return {
    external_id: 'MD-' + order.id,
    platform: 'maudau',
    order_date: order.created_at ? order.created_at.split('T')[0] : null,
    customer_name: order.recipient
      ? `${order.recipient.last_name || ''} ${order.recipient.first_name || ''}`.trim()
      : null,
    customer_phone: order.recipient?.phone || null,
    address: buildAddress(order.delivery_address),
    branch: buildBranch(order.delivery_address),
    items: buildItems(order.parcels || []),
    total: (order.total_price || 0) / 100,
    commission: (order.merchant_commission_amount || 0) / 100,
    status: STATUS_MAP[order.status] || order.status || null,
    status_raw: order.status || null,
    ttn: order.parcels?.[0]?.delivery_tracking_number || null,
    cancel_reason: order.cancel_reason || null,
    // What the buyer wrote when ordering — often a delivery instruction or a
    // corrected address, so it belongs in front of the operator
    customer_comment: (order.customer_comment ?? '').trim() || null,
    raw: order,
    updated_at: new Date().toISOString(),
  }
}

// Fetch all pages for a given query string
async function fetchAllPages(jwt: string, queryParam: string): Promise<Map<string, ReturnType<typeof orderToRow>>> {
  const map = new Map<string, ReturnType<typeof orderToRow>>()
  let page = 1
  const MAX_PAGES = 100 // safety limit
  while (page <= MAX_PAGES) {
    const url = `${BASE}/v1/merchant_public_api/orders?page=${page}&per_page=50&${queryParam}`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${jwt}` },
    })
    if (!res.ok) {
      throw new Error(
        `MauDau API ${res.status} on page ${page} [${queryParam}]: ${(await res.text()).slice(0, 200)}`
      )
    }
    const raw = await res.json()
    // API ignores per_page and returns ~15 per page as a bare array
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orders: any[] = Array.isArray(raw) ? raw : (raw.data?.orders ?? raw.orders ?? [])
    console.log(`MauDau page ${page} [${queryParam}]: ${orders.length} orders`)
    // Stop only when the page is empty — NOT when fewer than per_page,
    // because MauDau caps at ~15 per page regardless of per_page param
    if (!orders.length) break
    for (const o of orders) {
      map.set(String(o.id), orderToRow(o))
    }
    page++
  }
  return map
}

/** 'quick' polls only what changed recently — cheap enough to run every few
 *  minutes, and still catches brand-new orders because a new order's update
 *  time is its creation time. 'full' additionally re-reads the whole year so
 *  totals, TTNs and statuses on older orders cannot drift. */
export type SyncMode = 'full' | 'quick'

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export async function syncMaudau(mode: SyncMode = 'full'): Promise<{ synced: number }> {
  const supabase = createServiceClient()
  const jwt = await getMaudauJwt()

  const now = new Date()
  // MauDau filters by date, not timestamp — a 24h floor keeps the window safe
  // across midnight while still covering at most two calendar days.
  const updatedFrom = ymd(new Date(now.getTime() - 24 * 60 * 60 * 1000))
  const createdFrom = `${now.getFullYear()}-01-01`

  const updatedMap = await fetchAllPages(jwt, `updated_from=${encodeURIComponent(updatedFrom)}`)
  const createdMap = mode === 'full'
    ? await fetchAllPages(jwt, `created_from=${encodeURIComponent(createdFrom)}`)
    : new Map<string, ReturnType<typeof orderToRow>>()

  // Merge: updatedMap wins (fresher data)
  const merged = new Map([...createdMap, ...updatedMap])
  const rows = Array.from(merged.values())

  if (rows.length > 0) {
    // One read serves two purposes: which orders we already know about (so the
    // rest can be announced), and their cancel_reason — MauDau never returns
    // that field, so a blind upsert would wipe reasons we set ourselves.
    const externalIds = rows.map(r => r.external_id)
    const { data: existing } = await supabase
      .from('orders')
      .select('id, external_id, cancel_reason, status, ttn, customer_comment')
      .in('external_id', externalIds)
      .eq('platform', 'maudau')

    const known = new Set((existing ?? []).map(r => r.external_id as string))
    const freshOrders = rows.filter(r => !known.has(r.external_id))

    const existingComments = new Map(
      (existing ?? [])
        .filter(r => r.customer_comment)
        .map(r => [r.external_id as string, r.customer_comment as string])
    )

    // A waybill we created ourselves lives only here: MauDau has no number for
    // an order it delivers itself, and would otherwise blank ours every pass
    const existingTtns = new Map(
      (existing ?? [])
        .filter(r => r.ttn)
        .map(r => [r.external_id as string, r.ttn as string])
    )

    const existingReasons = new Map(
      (existing ?? [])
        .filter(r => r.cancel_reason != null)
        .map(r => [r.external_id as string, r.cancel_reason as string])
    )

    const rowsToUpsert = rows.map(r => ({
      ...r,
      cancel_reason: r.cancel_reason ?? existingReasons.get(r.external_id) ?? null,
      // A pass that brings no comment must not erase one we already have
      customer_comment: r.customer_comment ?? existingComments.get(r.external_id) ?? null,
      ttn: r.ttn ?? existingTtns.get(r.external_id) ?? null,
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

    // An order with a waybill that MauDau still shows as approved never got
    // its move to delivering — the operator closed the panel before it ran, or
    // the call failed. Finish it here rather than leaving the parcel shipped in
    // our records and pending in theirs.
    const stranded = rows.filter(r => {
      const mine = beforeById.get(r.external_id) as { ttn?: string | null } | undefined
      return hasWaybill(mine?.ttn) && (r.status === 'Узгоджено' || r.status === 'Прийнято')
    })
    for (const r of stranded.slice(0, 20)) {
      try {
        await patchMaudauStatus(r.external_id.replace(/^MD-/, ''), 'delivering')
      } catch {
        // Next run tries again; a stuck order must not fail the whole sync
      }
    }

    // Only after the rows are safely stored
    await notifyNewOrders(supabase, 'maudau', freshOrders)
    // A new order should appear on every open list at once, not at the next poll
    await broadcastOrderChange('*', 'sync')
  }

  return { synced: rows.length }
}

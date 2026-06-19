import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getMaudauJwt } from '@/lib/maudau'

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
    items: buildItems(order.parcels || []),
    total: (order.total_price || 0) / 100,
    commission: (order.merchant_commission_amount || 0) / 100,
    status: STATUS_MAP[order.status] || order.status || null,
    status_raw: order.status || null,
    ttn: order.parcels?.[0]?.delivery_tracking_number || null,
    cancel_reason: order.cancel_reason || null,
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
      console.error('MauDau orders fetch failed', res.status, url)
      break
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

export async function POST() {
  try {
    const supabase = createServiceClient()
    const jwt = await getMaudauJwt()

    const now = new Date()
    // created_from = start of current year (covers all months, not just current)
    // MauDau expects YYYY-MM-DD date string, not a full ISO timestamp
    const createdFrom = `${now.getFullYear()}-01-01`
    // updated_from = 2 hours ago (catches recently changed statuses on older orders)
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000)
    const updatedFrom = `${twoHoursAgo.getFullYear()}-${String(twoHoursAgo.getMonth() + 1).padStart(2, '0')}-${String(twoHoursAgo.getDate()).padStart(2, '0')}`

    // Dual fetch: by creation date (current month) + by update date (last 2h)
    const [createdMap, updatedMap] = await Promise.all([
      fetchAllPages(jwt, `created_from=${encodeURIComponent(createdFrom)}`),
      fetchAllPages(jwt, `updated_from=${encodeURIComponent(updatedFrom)}`),
    ])

    // Merge: updatedMap wins (fresher data)
    const merged = new Map([...createdMap, ...updatedMap])
    const rows = Array.from(merged.values())

    if (rows.length > 0) {
      const { error } = await supabase
        .from('orders')
        .upsert(rows, { onConflict: 'external_id,platform' })
      if (error) throw error
    }

    return NextResponse.json({ success: true, synced: rows.length })
  } catch (err) {
    console.error('MauDau sync error:', err)
    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 }
    )
  }
}

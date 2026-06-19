import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

const BASE = process.env.MAUDAU_BASE!
const LOGIN = process.env.MAUDAU_LOGIN!
const PASSWORD = process.env.MAUDAU_PASSWORD!

const STATUS_MAP: Record<string, string> = {
  new_order: 'Нове',
  accepted: 'Прийнято',
  approved: 'Узгоджено',
  delivering: 'На доставці',
  arrived: 'Прибуло',
  completed: 'Доставлено',
  canceled: 'Скасовано',
}

async function getJwt(): Promise<string> {
  // spec: POST /login (not /v1/merchant_public_api/login)
  const res = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: LOGIN, password: PASSWORD }),
  })
  if (!res.ok) {
    // fallback: try the /v1/merchant_public_api/login path
    const res2 = await fetch(`${BASE}/v1/merchant_public_api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: LOGIN, password: PASSWORD }),
    })
    if (!res2.ok) throw new Error(`MauDau login failed: ${res2.status}`)
    const d2 = await res2.json()
    return (d2.data?.jwt ?? d2.jwt) as string
  }
  const data = await res.json()
  // spec: response is {data: {jwt: "..."}}
  return (data.data?.jwt ?? data.jwt) as string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildAddress(delivery_address: any): string {
  if (!delivery_address) return ''
  const city = delivery_address.city?.name || ''
  const warehouse = delivery_address.warehouse?.address
  if (warehouse) return [city, warehouse].filter(Boolean).join(', ')
  const street = delivery_address.street || ''
  const building = delivery_address.building || ''
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
    const jwt = await getJwt()

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

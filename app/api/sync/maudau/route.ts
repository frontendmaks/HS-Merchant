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
  const res = await fetch(`${BASE}/v1/merchant_public_api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: LOGIN, password: PASSWORD }),
  })
  if (!res.ok) throw new Error(`MauDau login failed: ${res.status}`)
  const data = await res.json()
  return data.jwt as string
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

export async function POST() {
  try {
    const supabase = createServiceClient()
    const jwt = await getJwt()

    const now = new Date()
    const createdFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

    let page = 1
    let totalSynced = 0

    while (true) {
      const url = `${BASE}/v1/merchant_public_api/orders?page=${page}&per_page=50&created_from=${encodeURIComponent(createdFrom)}`
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${jwt}` },
      })
      if (!res.ok) throw new Error(`MauDau orders fetch failed: ${res.status}`)
      const data = await res.json()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const orders: any[] = data.orders || data || []
      if (!orders.length) break

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = orders.map((order: any) => ({
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
      }))

      const { error } = await supabase
        .from('orders')
        .upsert(rows, { onConflict: 'external_id,platform' })

      if (error) throw error
      totalSynced += rows.length

      if (orders.length < 50) break
      page++
    }

    return NextResponse.json({ success: true, synced: totalSynced })
  } catch (err) {
    console.error('MauDau sync error:', err)
    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 }
    )
  }
}

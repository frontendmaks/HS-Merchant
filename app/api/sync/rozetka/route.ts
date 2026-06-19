import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

const BASE = process.env.ROZETKA_BASE!
const TOKEN = process.env.ROZETKA_TOKEN!

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
    items: buildItems(order.purchases || []),
    total: Number(order.cost_with_discount || order.cost || 0),
    commission: commissionSum,
    status: STATUS_MAP[statusNum] || String(order.status),
    status_raw: String(order.status),
    ttn: order.ttn || null,
    cancel_reason: null,
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
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    if (!res.ok) break
    const data = await res.json()
    if (!data.success) break

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

export async function POST() {
  try {
    const supabase = createServiceClient()

    const now = new Date()
    // created_from = start of current year (covers all months, not just current)
    const monthStart = `${now.getFullYear()}-01-01`
    // updated_from = 2 hours ago (fresher statuses)
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000)
    const updatedFrom = `${twoHoursAgo.getFullYear()}-${String(twoHoursAgo.getMonth() + 1).padStart(2, '0')}-${String(twoHoursAgo.getDate()).padStart(2, '0')}`

    // Dual fetch
    const [createdMap, updatedMap] = await Promise.all([
      fetchPages(`created_from=${monthStart}`),
      fetchPages(`updated_from=${updatedFrom}`),
    ])

    // Merge: updatedMap wins
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
    console.error('Rozetka sync error:', err)
    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 }
    )
  }
}

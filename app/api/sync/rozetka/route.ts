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
  20: 'Комплектується',
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

export async function POST() {
  try {
    const supabase = createServiceClient()

    const now = new Date()
    const createdFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`

    let page = 1
    let pageCount = 1
    let totalSynced = 0

    while (page <= pageCount) {
      const url = `${BASE}/orders/search?page=${page}&pageSize=50&sort=-id&types=1&expand=purchases,delivery&created_from=${createdFrom}`
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      })
      if (!res.ok) throw new Error(`Rozetka orders fetch failed: ${res.status}`)
      const data = await res.json()

      if (!data.success) throw new Error('Rozetka API returned success=false')

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const orders: any[] = data.content?.orders || []
      pageCount = data.content?._meta?.pageCount || 1

      if (!orders.length) break

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = orders.map((order: any) => {
        const statusNum = Number(order.status)
        const isCanceled = CANCELED_STATUSES.has(statusNum)

        let customerName = ''
        if (order.recipient_title?.full_name) {
          customerName = order.recipient_title.full_name
        } else {
          customerName = [order.recipient_title?.last_name, order.recipient_title?.first_name, order.recipient_title?.second_name]
            .filter(Boolean).join(' ')
        }

        const commissionSum = isCanceled
          ? 0
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          : (order.purchases || []).reduce((s: number, p: any) => s + (Number(p.commission_sum) || 0), 0)

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
      })

      const { error } = await supabase
        .from('orders')
        .upsert(rows, { onConflict: 'external_id,platform' })

      if (error) throw error
      totalSynced += rows.length

      page++
    }

    return NextResponse.json({ success: true, synced: totalSynced })
  } catch (err) {
    console.error('Rozetka sync error:', err)
    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 }
    )
  }
}

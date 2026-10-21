import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor } from '@/lib/order-events'
import { phoneKey } from '@/lib/phone'

/**
 * GET /api/customers/<ключ>
 *
 * Картка клієнта: його замовлення й те, що він зазвичай бере. Тягнемо на
 * вимогу, коли рядок розгорнули — у списку з сотень клієнтів це дані, які
 * майже нікому не потрібні, поки їх не спитали.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  if (!await currentActor()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { key } = await params
  const digits = phoneKey(key)
  if (!digits) return NextResponse.json({ error: 'Невірний номер' }, { status: 400 })

  const service = createServiceClient()

  const [{ data: orders }, { data: products }] = await Promise.all([
    service.from('orders')
      .select('id, external_id, manual_number, platform, order_date, status, total, address, warehouse, delivery_date, delivery_slot, review:order_reviews(rating, comment)')
      .filter('customer_phone', 'like', `%${digits}`)
      .order('order_date', { ascending: false })
      .limit(50),
    service.from('customer_products')
      .select('title, qty, unit, times, last_order')
      .eq('phone_key', digits)
      .order('times', { ascending: false })
      .limit(15),
  ])

  return NextResponse.json({ orders: orders ?? [], products: products ?? [] })
}

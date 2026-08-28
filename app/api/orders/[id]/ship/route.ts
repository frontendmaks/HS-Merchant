/**
 * POST /api/orders/[id]/ship
 *
 * Marks an order shipped once its waybill exists. Separate from creating the
 * waybill so the dialog can close on a saved number and the order moves a
 * moment later, rather than holding the operator while the marketplace
 * catches up.
 *
 * Safe to call more than once: an order already shipped is reported as such
 * rather than pushed again.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor, logOrderEvent } from '@/lib/order-events'
import { markShippedAtMarketplace } from '@/lib/marketplace-ttn'
import { broadcastOrderChange } from '@/lib/order-broadcast'
import { hasWaybill, isShipping } from '@/lib/order-statuses'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await currentActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const service = createServiceClient()

  const { data: order } = await service
    .from('orders').select('status, ttn, platform, external_id').eq('id', id).single()

  if (!order) return NextResponse.json({ error: 'Замовлення не знайдено' }, { status: 404 })
  if (!hasWaybill(order.ttn as string)) {
    return NextResponse.json({ error: 'Немає накладної' }, { status: 400 })
  }
  if (isShipping(order.status as string)) {
    return NextResponse.json({ ok: true, status: order.status, already: true })
  }

  const pushed = await markShippedAtMarketplace(
    order.platform as string, order.external_id as string)

  if (!pushed.ok) {
    return NextResponse.json({ error: pushed.error }, { status: 502 })
  }

  const status = pushed.status
  if (status && status !== order.status) {
    await service.from('orders')
      .update({ status, updated_at: new Date().toISOString() }).eq('id', id)
    await logOrderEvent(service, id, 'status',
      { old: (order.status as string) ?? null, new: status, details: 'після створення ТТН' }, actor)
    await broadcastOrderChange(id, 'status')
  }

  return NextResponse.json({ ok: true, status })
}

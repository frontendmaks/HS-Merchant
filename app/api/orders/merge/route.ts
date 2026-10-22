import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentRole, canAccess } from '@/lib/getRole'
import { currentActor, logOrderEvent } from '@/lib/order-events'
import { mergeOrders } from '@/lib/order-merge'
import { broadcastOrderChange } from '@/lib/order-broadcast'
import { isValidSlot } from '@/lib/delivery-slots'

export async function POST(request: NextRequest) {
  const role = await getCurrentRole()
  if (!canAccess('manualOrders', role)) {
    return NextResponse.json({ error: 'Немає доступу' }, { status: 403 })
  }

  const actor = await currentActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null) as {
    orderIds?: string[]
    deliveryDate?: string
    deliverySlot?: string
  } | null

  const orderIds = (body?.orderIds ?? []).filter(Boolean)
  const deliveryDate = body?.deliveryDate ?? ''
  const deliverySlot = body?.deliverySlot ?? ''

  if (!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)) {
    return NextResponse.json({ error: 'Оберіть дату доставки' }, { status: 400 })
  }
  if (!isValidSlot(deliverySlot)) {
    return NextResponse.json({ error: 'Оберіть період доставки' }, { status: 400 })
  }

  const service = createServiceClient()
  const result = await mergeOrders(service, { orderIds, deliveryDate, deliverySlot })

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 409 })
  }

  for (const id of orderIds) {
    await logOrderEvent(service, id, 'items',
      { details: { merged_into: result.orderId } }, actor)
  }
  await logOrderEvent(service, result.orderId, 'created',
    { details: {
      merged_from: orderIds.length, lines: result.lines, number: result.number,
    } }, actor)

  await broadcastOrderChange(result.orderId, 'sync')

  return NextResponse.json({ ok: true, ...result })
}

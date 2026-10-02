import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor, logOrderEvent } from '@/lib/order-events'
import { broadcastOrderChange } from '@/lib/order-broadcast'
import { canTogglePaid, isHandedOver } from '@/lib/order-statuses'

/**
 * Позначка про передоплату.
 *
 * Міняється лише на стадії узгодження — до неї платити нема за що, після неї
 * замовлення вже їде. Кожна зміна лягає в журнал: питання «хто сказав, що
 * оплачено» виникає рівно тоді, коли грошей немає.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const { paid } = (await req.json()) as { paid: boolean }

  const actor = await currentActor()
  if (!actor) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient()
  const { data: current } = await supabase
    .from('orders').select('status, ttn, is_paid').eq('id', id).single()

  if (!current) {
    return NextResponse.json({ success: false, error: 'Замовлення не знайдено' }, { status: 404 })
  }

  if (isHandedOver(current.status as string, current.ttn as string)) {
    return NextResponse.json(
      { success: false, error: 'Замовлення вже в доставці — оплату не змінюють' },
      { status: 409 },
    )
  }

  if (!canTogglePaid(current.status as string)) {
    return NextResponse.json(
      { success: false, error: 'Оплату можна позначити лише на статусі «Узгоджено»' },
      { status: 409 },
    )
  }

  const next = !!paid
  if (next === current.is_paid) return NextResponse.json({ success: true, is_paid: next })

  const { error } = await supabase.from('orders').update({
    is_paid: next,
    paid_at: next ? new Date().toISOString() : null,
    paid_by: next ? actor.id : null,
    updated_at: new Date().toISOString(),
  }).eq('id', id)

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

  await logOrderEvent(supabase, id, 'payment',
    { old: current.is_paid ? 'Оплачено' : 'Не оплачено', new: next ? 'Оплачено' : 'Не оплачено' },
    actor)

  await broadcastOrderChange(id, 'status')
  return NextResponse.json({ success: true, is_paid: next })
}

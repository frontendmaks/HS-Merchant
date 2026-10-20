import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor } from '@/lib/order-events'
import { reserveNumber } from '@/lib/manual-register'
import { changeOrderStatus } from '@/lib/order-status-change'
import { PICKING_STAGE } from '@/lib/bitrix-chat'
import { orderSource } from '@/lib/order-source'
import { bitrix } from '@/lib/bitrix'

/**
 * POST /api/orders/<id>/approve — «беру на себе».
 *
 * Оператор подивився на замовлення, яке огляд відклав, і вирішив, що воно
 * готове: адреса зрозуміла людині, навіть якщо не зрозуміла довіднику. Тоді
 * лишається механічне — взяти номер із журналу й перевести на комплектацію,
 * щоб бланк пішов на склад. Саме це тут і робиться, одним натисканням.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await currentActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const service = createServiceClient()

  const { data: order } = await service
    .from('orders')
    .select('id, platform, status, external_id, customer_name, delivery_date, manual_number, bitrix_deal_id')
    .eq('id', id).single()

  if (!order) return NextResponse.json({ error: 'Замовлення не знайдено' }, { status: 404 })
  if (orderSource(order.platform) !== 'site') {
    return NextResponse.json({ error: 'Лише для замовлень сайту й телефону' }, { status: 409 })
  }

  let number = order.manual_number as number | null
  let note: string | null = null

  // Номер беремо лише якщо його ще немає: повторне натискання не має
  // з'їдати другий рядок журналу
  if (number == null && order.delivery_date) {
    const reserved = await reserveNumber(
      service,
      order.delivery_date as string,
      (order.customer_name as string) || 'замовлення з сайту',
    )
    number = reserved.number
    note = reserved.note

    await service.from('orders')
      .update({ manual_number: number, number_source: reserved.source })
      .eq('id', id)

    if (order.bitrix_deal_id) {
      await bitrix('crm.deal.update', {
        id: order.bitrix_deal_id,
        fields: { UF_CRM_1607510002583: String(number) },
      })
    }
  }

  // Огляд більше нічого не вирішує: рішення прийняла людина
  await service.from('orders')
    .update({ auto_done_at: new Date().toISOString(), auto_problem: null })
    .eq('id', id)

  if (order.status !== PICKING_STAGE) {
    const moved = await changeOrderStatus({
      id,
      status: PICKING_STAGE,
      platform: order.platform as string,
      external_id: (order.external_id as string) ?? '',
      actor,
    })
    if (!moved.ok) {
      const body = await moved.json().catch(() => ({})) as { error?: string }
      return NextResponse.json(
        { error: body.error ?? 'Не вдалося перевести на комплектацію', number },
        { status: 409 },
      )
    }
  }

  const { data: after } = await service
    .from('orders').select('chat_sent_at, chat_error').eq('id', id).single()

  return NextResponse.json({
    ok: true,
    number,
    note,
    sheet_sent: !!after?.chat_sent_at,
    chat_error: after?.chat_error ?? null,
  })
}

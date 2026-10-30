import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentRole } from '@/lib/getRole'
import { currentActor } from '@/lib/order-events'
import { bitrix, bitrixConfigured } from '@/lib/bitrix'
import { stageId } from '@/lib/bitrix-stages'

/** Видаляти може лише той, хто відповідає за дані, а не той, хто їх вводить */
const ALLOWED = ['super_admin', 'admin']

/**
 * Видалення замовлення.
 *
 * Незворотне й тому вузьке: прибираємо своє — рядок, позиції, листування
 * по ньому. В чужих системах не стираємо нічого: угоду в Бітріксі
 * переводимо в «Скасовано», картку на дошці ховаємо в архів.
 *
 * Так зроблено свідомо. Видалена угода забирає з собою історію дзвінків
 * і коментарів, якої в нас немає й не буде, а бухгалтерія потім не
 * зрозуміє, куди подівся день. Закрита угода відповідає на це питання.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const role = await getCurrentRole()
  if (!ALLOWED.includes(role ?? '')) {
    return NextResponse.json({ error: 'Видаляти замовлення може адміністратор' }, { status: 403 })
  }

  const actor = await currentActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const service = createServiceClient()

  const { data: order } = await service
    .from('orders')
    .select('id, external_id, bitrix_deal_id, manual_number, delivery_date, number_source')
    .eq('id', id).maybeSingle()

  if (!order) return NextResponse.json({ error: 'Замовлення не знайдено' }, { status: 404 })

  const notes: string[] = []

  // Картку з дошки прибираємо першою: після видалення рядка ми вже не
  // знатимемо, за чим її шукати
  try {
    const { cardCanceled } = await import('@/lib/trello-cards')
    const card = await cardCanceled(service, id)
    notes.push(card.ok ? `картку прибрано (${card.note})` : `картка: ${card.note}`)
  } catch { notes.push('картку прибрати не вдалося') }

  if (bitrixConfigured() && order.bitrix_deal_id) {
    const canceled = stageId('Скасовано')
    try {
      await bitrix('crm.deal.update', {
        id: Number(order.bitrix_deal_id),
        fields: {
          STAGE_ID: canceled,
          COMMENTS: `Замовлення видалено з Мерчанта (${actor.name})`,
        },
      })
      notes.push('угоду закрито')
    } catch { notes.push('угоду закрити не вдалося') }
  }

  /*
   * Номер повертаємо в журнал.
   *
   * Видалене замовлення ящика не займає, і лишати його число зайнятим
   * означає діру в нумерації, якої ніхто потім не пояснить.
   */
  /* Номер звільняємо незалежно від того, чи дійшов він до аркуша:
     тримає його журнал, і саме журнал має його відпустити */
  if (order.manual_number != null && order.delivery_date && order.number_source) {
    try {
      const { releaseNumber } = await import('@/lib/manual-register')
      await releaseNumber(service, {
        number: Number(order.manual_number),
        date: order.delivery_date as string,
      })
      notes.push('номер звільнено')
    } catch { notes.push('номер звільнити не вдалося') }
  }

  // Позиції, події та повідомлення йдуть каскадом або руками — залежно
  // від того, як описані зв'язки
  await service.from('order_items').delete().eq('order_id', id)
  await service.from('customer_messages').delete().eq('order_id', id)
  await service.from('order_events').delete().eq('order_id', id)
  await service.from('order_numbers').update({ order_id: null }).eq('order_id', id)
  await service.from('orders').update({ moved_to_order_id: null }).eq('moved_to_order_id', id)

  const { error } = await service.from('orders').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, external_id: order.external_id, notes })
}

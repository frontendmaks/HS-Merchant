import { randomBytes } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor, logOrderEvent } from '@/lib/order-events'
import { broadcastOrderChange } from '@/lib/order-broadcast'
import { notifyIntegrations } from '@/lib/integration-webhooks'
import { isValidSlot, slotsForDate } from '@/lib/delivery-slots'
import {
  MANUAL_PLATFORM, manualExternalId, manualWeight,
  orderTotal, lineTotal, type ManualLine,
} from '@/lib/manual-orders'
import { reserveNumber } from '@/lib/manual-register'
import { withDelivery } from '@/lib/delivery-fee'
import { pushOrderToBitrix } from '@/lib/bitrix-deal'
import { bitrixConfigured } from '@/lib/bitrix'
import { sendOrderSheet } from '@/lib/bitrix-chat'

/**
 * POST /api/orders/manual — прийняти замовлення по телефону.
 *
 * Створює звичайне замовлення з платформою «manual»: далі з ним працюють
 * тими самими засобами, що й із маркетплейсним.
 */
export async function POST(req: NextRequest) {
  const actor = await currentActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null) as {
    customer_name?: string
    customer_phone?: string
    address?: string
    warehouse?: string | null
    delivery_zone?: string | null
    delivery_date?: string
    delivery_slot?: string
    comment?: string | null
    lines?: ManualLine[]
  } | null

  const name = body?.customer_name?.trim()
  const phone = body?.customer_phone?.trim()
  const address = body?.address?.trim()
  const date = body?.delivery_date
  const slot = body?.delivery_slot
  const goods = (body?.lines ?? []).filter(l => l.title?.trim() && Number(l.qty) > 0)
  // Доставку додаємо тут, а не в формі: правило про тисячу має діяти однаково,
  // хто б і звідки замовлення не прислав
  const lines = withDelivery(goods)

  if (!name) return NextResponse.json({ error: 'Вкажіть ПІБ клієнта' }, { status: 400 })
  if (!phone) return NextResponse.json({ error: 'Вкажіть телефон' }, { status: 400 })
  if (!address) return NextResponse.json({ error: 'Вкажіть адресу' }, { status: 400 })
  // Без складу замовлення нікуди не потрапляє: бланк друкують саме там
  if (!body?.warehouse?.trim()) {
    return NextResponse.json({ error: 'Оберіть склад замовлення' }, { status: 400 })
  }
  if (!date || !slot || !isValidSlot(slot)) {
    return NextResponse.json({ error: 'Оберіть дату й період доставки' }, { status: 400 })
  }
  if (!goods.length) {
    return NextResponse.json({ error: 'Додайте хоча б один товар' }, { status: 400 })
  }

  // Період міг закритись, поки оператор набирав замовлення — буфер на те й є
  const slotNow = slotsForDate(date).find(s => s.label === slot)
  if (!slotNow?.available) {
    return NextResponse.json(
      { error: `Період ${slot} уже недоступний${slotNow?.reason ? ` — ${slotNow.reason}` : ''}` },
      { status: 409 },
    )
  }

  const service = createServiceClient()
  const total = orderTotal(lines)
  // Вага — тільки товари: доставка не їде у ваговій накладній
  const weight = manualWeight(goods)

  /**
   * Номер і запис — з повтором при зіткненні.
   *
   * Двоє операторів можуть оформляти одночасно, і тоді обидва побачать той
   * самий «останній вільний». Унікальний індекс не дасть зберегти дубль, а ми
   * просто візьмемо наступний — замість того щоб показати людині помилку, якої
   * вона не спричиняла.
   */
  type Created = {
    id: string; manual_number: number; external_id: string; share_token: string
  }
  let created: Created | null = null
  let lastError = ''

  // Номер беремо з журналу — тієї самої таблиці, куди пишуть і руками
  const reserved = await reserveNumber(service, date, name)

  for (let attempt = 0; attempt < 5 && !created; attempt++) {
    const number = attempt === 0
      ? reserved.number
      : reserved.number + attempt
    const externalId = manualExternalId(date, number)

    const { data, error } = await service.from('orders').insert({
      external_id: externalId,
      platform: MANUAL_PLATFORM,
      manual_number: number,
      order_date: date,
      delivery_date: date,
      delivery_slot: slot,
      delivery_zone: body?.delivery_zone ?? null,
      warehouse: body?.warehouse ?? null,
      customer_name: name,
      customer_phone: phone,
      address,
      status: 'Прийнято',
      total,
      commission: 0,
      weight,
      seats_amount: 1,
      operator_comment: body?.comment?.trim() || null,
      created_by: actor.id,
      number_source: reserved.source,
      // Токен для бланка складу: комірник відкриває його без акаунта
      share_token: randomBytes(18).toString('base64url'),
      items: lines.map(l => `${l.title}, ${l.qty} ${l.unit} x ${l.price_per_unit} грн`).join('\n'),
    }).select('id, manual_number, external_id, share_token').single()

    if (!error && data) {
      created = data as Created
      break
    }
    lastError = error?.message ?? 'Не вдалося створити замовлення'
    // Унікальний індекс спрацював — пробуємо наступний номер
    if (!error?.message?.includes('duplicate')) break
  }

  if (!created) {
    return NextResponse.json({ error: lastError }, { status: 500 })
  }

  await service.from('order_items').insert(lines.map((l, i) => ({
    order_id: created!.id,
    position: i,
    source: 'manual',
    product_id: l.product_id ?? null,
    title: l.title.trim(),
    unit: l.unit || 'шт',
    unit_weight: Number(l.unit_weight ?? 0),
    price_per_unit: Number(l.price_per_unit ?? 0),
    ordered_qty: Number(l.qty),
    ordered_total: lineTotal(l),
    removed: false,
  })))

  await logOrderEvent(service, created.id, 'created', {
    details: {
      number: created.manual_number,
    number_source: reserved.source,
    number_note: reserved.note, slot, warehouse: body?.warehouse ?? null,
      lines: lines.length, total,
    },
  }, actor)

  await broadcastOrderChange(created.id, 'items')
  await notifyIntegrations(created.id, 'order.created', service)

  /**
   * Угода в Бітріксі.
   *
   * Якщо CRM не відповіла, замовлення все одно прийняте: воно вже в базі, у
   * журналі й на бланку. Помилка лишається на замовленні, і надіслати його
   * можна повторно — повторний виклик оновлює ту саму угоду.
   */
  const crm = bitrixConfigured()
    ? await pushOrderToBitrix(service, created.id)
    : { error: 'Бітрікс не налаштовано' }

  /**
   * Бланк — у чат складу.
   *
   * Склад уже вирахувано з адреси, а в кожного складу свій чат: посилання
   * доїжджає туди, де замовлення збиратимуть, без пересилань руками.
   */
  const chat = bitrixConfigured()
    ? await sendOrderSheet(service, created.id)
    : { error: 'Бітрікс не налаштовано' }

  return NextResponse.json({
    ok: true,
    id: created.id,
    deal_id: 'dealId' in crm ? crm.dealId : null,
    crm_error: 'error' in crm ? crm.error : null,
    chat_error: 'error' in chat ? chat.error : null,
    number: created.manual_number,
    number_source: reserved.source,
    number_note: reserved.note,
    external_id: created.external_id,
    total,
    weight,
    share_token: created.share_token,
    /** Посилання для складу — відкривається без входу в Мерчант */
    document_url: `/zamovlennya/${created.share_token}`,
  })
}

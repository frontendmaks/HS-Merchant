import { randomBytes } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor, logOrderEvent } from '@/lib/order-events'
import { broadcastOrderChange } from '@/lib/order-broadcast'
import { notifyIntegrations } from '@/lib/integration-webhooks'
import { isValidSlot, slotsForDate } from '@/lib/delivery-slots'
import { getSetting } from '@/lib/settings'
import {
  MANUAL_PLATFORM, manualExternalId, manualWeight,
  orderTotal, lineTotal, type ManualLine,
} from '@/lib/manual-orders'
import { reserveNumber, linkNumber, releaseNumber } from '@/lib/manual-register'
import { withDelivery, isDeliveryLine } from '@/lib/delivery-fee'
import { pushOrderToBitrix } from '@/lib/bitrix-deal'
import { bitrixConfigured } from '@/lib/bitrix'

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
  const typed = (body?.lines ?? []).filter(l => l.title?.trim() && Number(l.qty) > 0)
  const goods = typed.filter(l => !isDeliveryLine(l))

  /*
   * Доставку рахуємо самі — крім випадку, коли її вписала людина.
   *
   * Правило про тисячу має діяти однаково, хто б і звідки замовлення не
   * прислав, тож за звичайних обставин рядок доставки додається тут, а не
   * у формі. Але оператор говорить із клієнтом і знає те, чого не знає
   * правило: далеке село, домовлена сума, виняток. Якщо він вписав
   * доставку сам, вона й лишається — хоч би що казав поріг.
   *
   * Раніше `withDelivery` прибирала всі такі рядки й додавала свій за
   * порогом: у замовленні на 2234 грн доставка була безкоштовна, і
   * вписаний оператором рядок зникав безслідно — ні в переліку, ні в
   * бланку, ні в угоді.
   */
  const lines = typed.some(isDeliveryLine) ? typed : withDelivery(goods)

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

  const service = createServiceClient()

  // Період міг закритись, поки оператор набирав замовлення — буфер на те й є
  const slotNow = slotsForDate(date, await getSetting(service, 'delivery_buffer_minutes'))
    .find(s => s.label === slot)
  if (!slotNow?.available) {
    return NextResponse.json(
      { error: `Період ${slot} уже недоступний${slotNow?.reason ? ` — ${slotNow.reason}` : ''}` },
      { status: 409 },
    )
  }

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

  /*
   * Номер беремо з журналу — тієї самої таблиці, куди пишуть і руками.
   *
   * І беремо рівно стільки разів, скільки треба, щоб замовлення
   * створилось. Раніше при невдачі наступний номер просто вигадувався —
   * «той, що взяли, плюс один», — повз журнал, повз аркуш і повз інші
   * замовлення. Так телефонне замовлення дістало сьомий номер, хоч його
   * вже везли іншій людині: єдина перевірка, яка там була, стосувалась
   * видимого номера замовлення (МР-22.10-7), а не номера ящика.
   *
   * Тепер кожна спроба — це чесний резерв, а невдала спроба свій номер
   * одразу повертає. Згорілих чисел не лишається.
   */
  const reserved = await reserveNumber(service, date, name)
  const number = reserved.number

  for (let attempt = 0; attempt < 5 && !created; attempt++) {
    /*
     * Номер ящика тримаємо, змінюємо лише підпис.
     *
     * Видимий номер замовлення — «МР-22.10-3» — унікальний назавжди, і
     * скасоване замовлення тримає своє позначення до кінця дня. Через це
     * вставка з третім номером падала, і код вигадував собі наступні
     * числа повз журнал: так Кучинська дістала сьомий, уже зайнятий.
     *
     * Але зайняте тут лише позначення, а не ящик. Ящик третій, журнал це
     * підтвердив, і саме він має лишитись; підпису ж додаємо хвостик.
     */
    const externalId = attempt === 0
      ? manualExternalId(date, number)
      : `${manualExternalId(date, number)}-${attempt + 1}`

    const { data, error } = await service.from('orders').insert({
      external_id: externalId,
      platform: MANUAL_PLATFORM,
      manual_number: number,
      order_date: date,
      delivery_date: date,
      delivery_slot: slot,
      delivery_zone: body?.delivery_zone ?? null,
      warehouse: body?.warehouse ?? null,
      // Склад назвала людина — огляд його не переставляє, лише звіряє
      warehouse_pinned: !!body?.warehouse,
      customer_name: name,
      customer_phone: phone,
      address,
      // Той самий словник, що й у сайтових: замовлення живе в одній воронці
      // Бітрікса, і два слова про один стан нікому не допомагають
      status: 'В обробці',
      total,
      commission: 0,
      weight,
      seats_amount: 1,
      operator_comment: body?.comment?.trim() || null,
      created_by: actor.id,
      number_source: reserved.source,
      // Токен для бланка складу: комірник відкриває його без акаунта
      share_token: randomBytes(18).toString('base64url'),
      items: lines.map(l => {
        const amount = l.order_unit === 'шт' && l.pieces
          ? `${l.pieces} шт (≈${l.qty} кг)`
          : `${l.qty} ${l.unit}`
        return `${l.title}, ${amount} x ${l.price_per_unit} грн`
      }).join('\n'),
    }).select('id, manual_number, external_id, share_token').single()

    if (!error && data) {
      created = data as Created
      break
    }
    lastError = error?.message ?? 'Не вдалося створити замовлення'
    // Унікальний індекс спрацював — пробуємо інший підпис, той самий ящик
    if (!error?.message?.includes('duplicate')) break
  }

  if (!created) {
    /*
     * Замовлення немає — номер має повернутись у обіг.
     *
     * Інакше в аркуші складу навпроти числа стоїть ім'я людини, якій
     * нічого не везуть, а нумерація дня йде далі через порожнє місце.
     */
    await releaseNumber(service, {
      number, date, reason: 'замовлення не створилось',
    })
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
    // Штуки зберігаємо окремо: клієнт замовив саме їх, а не вагу
    order_unit: l.order_unit ?? null,
    ordered_pieces: l.order_unit === 'шт' ? Number(l.pieces ?? 0) || null : null,
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
  // Номер резервували до того, як замовлення існувало, — тепер journal
  // може сказати, за ким він записаний
  await linkNumber(service, { date, number: created.manual_number, orderId: created.id })

  const crm = bitrixConfigured()
    ? await pushOrderToBitrix(service, created.id)
    : { error: 'Бітрікс не налаштовано' }

  /*
   * Далі замовлення чекає людину.
   *
   * Раніше воно одразу йшло на комплектацію: вважалось, що оператор склав
   * його з клієнтом на лінії й перевіряти нема чого. Але огляд устигає
   * знайти те, чого оператор не бачить, — переплутану назву села, адресу
   * поза зонами, склад, який не збігається з адресою, — а бланк, посланий
   * одразу, забирає цю можливість: склад уже збирає.
   *
   * Тож телефонне замовлення йде тим самим шляхом, що й сайтове: огляд,
   * вкладка «Перевірено», і лише тоді людина переводить його далі. Бланк
   * піде з тієї самої зміни статусу.
   */

  return NextResponse.json({
    ok: true,
    id: created.id,
    deal_id: 'dealId' in crm ? crm.dealId : null,
    crm_error: 'error' in crm ? crm.error : null,
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

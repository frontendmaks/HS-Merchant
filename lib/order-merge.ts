/**
 * Об'єднання передзамовлень в одне.
 *
 * Сайт дозволяє покупцеві взяти лише одну позицію за раз, тож людина, яка
 * хоче чотири товари, лишає чотири замовлення. Для складу це чотири ящики
 * на одну адресу, чотири бланки й чотири поїздки в одне місце.
 *
 * Тому об'єднуємо: народжується одне замовлення з усіма позиціями, своїм
 * номером і своєю угодою, а вихідні закриваються — так само, як при
 * перенесенні на інший день. Аналітика їх не рахує, інакше той самий
 * покупець і ті самі гроші потрапили б у підсумок двічі.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { randomBytes } from 'node:crypto'
import { bitrix } from '@/lib/bitrix'
import {
  FIELD, WAREHOUSE_ID, CATEGORY_ID, NEW_STAGE, ASSIGNED_BY, contactFor, addDealOnce,
  updateDealChecked,
} from '@/lib/bitrix-deal'
import { slotId } from '@/lib/bitrix-slots'
import { stageId, stageName } from '@/lib/bitrix-stages'
import { phoneKey } from '@/lib/phone'
import {
  DELIVERY_TITLE, DELIVERY_FEE, FREE_DELIVERY_FROM, BITRIX_DELIVERY_PRODUCT_ID,
  chargesOwnDelivery,
} from '@/lib/delivery-fee'
import { reserveNumber, releaseNumber, linkNumber } from '@/lib/manual-register'

type Service = ReturnType<typeof createServiceClient>

export const MERGED_REASON = 'об’єднано в одне замовлення'

export interface MergeResult {
  orderId: string
  dealId: number
  merged: number
  lines: number
  /** Номер ящика, який об'єднане дістало з журналу */
  number: number
  /** Що завадило взяти його з таблиці, якщо завадило */
  numberNote: string | null
  /** Скільки рядків дало кожне з вихідних — щоб було видно, що все зійшлось */
  from: { deal: number | null; lines: number }[]
}

interface Row {
  id: string
  platform: string | null
  bitrix_deal_id: number | null
  customer_name: string | null
  customer_phone: string | null
  address: string | null
  warehouse: string | null
  warehouse_pinned: boolean | null
  delivery_zone: string | null
  area: string | null
  customer_comment: string | null
  delivery_date: string | null
  manual_number: number | null
  status: string | null
  moved_to_order_id: string | null
  total: number | null
}

export async function mergeOrders(
  service: Service,
  { orderIds, deliveryDate, deliverySlot }: {
    orderIds: string[]
    deliveryDate: string
    deliverySlot: string
  },
): Promise<MergeResult | { error: string }> {
  if (orderIds.length < 2) return { error: 'Оберіть принаймні два замовлення' }

  const { data } = await service
    .from('orders')
    .select('id, platform, bitrix_deal_id, customer_name, customer_phone, address, warehouse, warehouse_pinned, delivery_zone, area, customer_comment, delivery_date, manual_number, status, moved_to_order_id, total')
    .in('id', orderIds)

  const rows = (data ?? []) as unknown as Row[]
  if (rows.length !== orderIds.length) return { error: 'Якісь із замовлень не знайдено' }
  if (rows.some(r => r.moved_to_order_id)) {
    return { error: 'Якесь із замовлень уже об’єднане або перенесене' }
  }

  /*
   * Один покупець — одне замовлення.
   *
   * Звіряємось за телефоном, а не за іменем: у цих замовленнях ім'я
   * буває різне («Дмитро» і «Антоніна» з одного номера), бо на сайті
   * його вписують щоразу наново. Телефон же той самий, і саме він
   * визначає, кому везти.
   */
  const phones = new Set(rows.map(r => phoneKey(r.customer_phone)).filter(Boolean))
  if (phones.size !== 1) {
    return { error: 'Замовлення різних покупців об’єднувати не можна' }
  }

  // Беремо найперше за порядком — його адресу й склад оператор уже бачив
  const base = rows.find(r => r.id === orderIds[0]) ?? rows[0]

  /*
   * Позиції читаємо по замовленню, а не одним списком.
   *
   * Одним списком не видно, чиї рядки прийшли: якщо котресь замовлення
   * віддало нуль, загальна кількість усе одно більша за нуль, і
   * об'єднання тихо збирає половину. Саме так Ольховик дістав три
   * позиції замість одинадцяти — і дізнались ми про це з бланка.
   *
   * Тому питаємо кожне окремо й вимагаємо від кожного бодай один рядок.
   * Порожнє замовлення — це або помилка читання, або справді порожня
   * угода; і в першому, і в другому випадку об'єднувати ще рано.
   */
  const byOrder = new Map<string, Record<string, unknown>[]>()

  for (const id of orderIds) {
    const { data: part } = await service
      .from('order_items')
      .select('*')
      .eq('order_id', id)
      .eq('removed', false)
      .order('position')

    byOrder.set(id, (part ?? []) as Record<string, unknown>[])
  }

  const empty = orderIds.filter(id => !byOrder.get(id)?.length)
  if (empty.length) {
    const who = empty
      .map(id => rows.find(r => r.id === id)?.bitrix_deal_id)
      .map(deal => (deal ? `#${deal}` : 'замовлення'))
      .join(', ')
    return {
      error: `У ${who} не видно позицій — об'єднувати рано. `
        + 'Відкрийте замовлення, переконайтесь, що товари на місці, і спробуйте ще раз.',
    }
  }

  const collected = orderIds.flatMap(id => byOrder.get(id) ?? [])

  /*
   * Доставка в об'єднаному — одна й перерахована.
   *
   * Кожне з вихідних везли окремо, і в кожному міг стояти свій рядок
   * доставки. Разом це одна поїздка, тож двох рядків бути не може. А ще
   * сума разом часто перевалює за поріг безкоштовної доставки — і тоді
   * рядка не має бути зовсім: клієнт заплатив би за те, що вже безкоштовне.
   */
  const goods = collected.filter(l => String(l.title ?? '').trim() !== DELIVERY_TITLE)
  const goodsSum = goods.reduce((sum, l) => sum + Number(l.ordered_total ?? 0), 0)

  /*
   * Маркетплейсне замовлення нашої доставки не знає.
   *
   * Його везе майданчик за своїми умовами, і ціну покупець уже бачив у
   * чеку. Об'єднувати такі замовлення не випадає взагалі, але правило
   * має стояти тут, а не триматись на тому, що в інтерфейс їх не
   * показують.
   */
  const ourDelivery = rows.every(r => chargesOwnDelivery(r.platform))
  const fee = ourDelivery && goodsSum <= FREE_DELIVERY_FROM ? DELIVERY_FEE : 0

  const deliveryRow = collected.find(l => String(l.title ?? '').trim() === DELIVERY_TITLE)

  const lines = fee > 0
    ? [...goods, {
        ...(deliveryRow ?? {}),
        title: DELIVERY_TITLE,
        unit: 'шт',
        unit_weight: 0,
        bitrix_product_id: BITRIX_DELIVERY_PRODUCT_ID,
        product_id: null,
        price_per_unit: fee,
        ordered_qty: 1,
        ordered_total: fee,
        removed: false,
      }]
    : goods

  const contactId = base.customer_name && base.customer_phone
    ? (await contactFor(base.customer_name, base.customer_phone)).id
    : null

  const total = Math.round(
    lines.reduce((s, l) => s + Number(l.ordered_total ?? 0), 0) * 100,
  ) / 100

  /*
   * Ключ цього об'єднання: день і склад тих, кого зводимо.
   *
   * Двічі звести те саме в той самий день не можна, тож повтор після
   * помилки знайде ту саму угоду, а не заведе другу.
   */
  const mergeKey = `merge-${deliveryDate}-${rows.map(r => r.id).sort().join('_').slice(0, 60)}`

  const fields: Record<string, unknown> = {
    TITLE: `Замовлення (об’єднано ${rows.length})`,
    CATEGORY_ID,
    STAGE_ID: NEW_STAGE,
    ASSIGNED_BY_ID: ASSIGNED_BY,
    CURRENCY_ID: 'UAH',
    OPENED: 'Y',
    COMMENTS: [
      base.customer_comment,
      `Об’єднано з ${rows.length} передзамовлень: `
        + rows.map(r => r.bitrix_deal_id ? `#${r.bitrix_deal_id}` : '—').join(', '),
    ].filter(Boolean).join('\n'),
    ...(contactId ? { CONTACT_ID: contactId } : {}),
    [FIELD.warehouse]: base.warehouse ? WAREHOUSE_ID[base.warehouse] ?? '' : '',
    [FIELD.deliveryDate]: `${deliveryDate}T03:00:00+03:00`,
    [FIELD.deliverySlot]: await slotId(deliverySlot),
    [FIELD.address]: base.address ?? '',
    /* Ключ об'єднання — щоб після помилки знайти вже створену угоду */
    [FIELD.orderKey]: mergeKey,
  }

  let dealId: number
  try {
    dealId = await addDealOnce(mergeKey, fields)

    await bitrix('crm.deal.productrows.set', {
      id: dealId,
      rows: lines.map(l => ({
        ...(l.bitrix_product_id ? { PRODUCT_ID: l.bitrix_product_id } : {}),
        PRODUCT_NAME: l.title,
        PRICE: Number(l.price_per_unit ?? 0),
        QUANTITY: Number(l.ordered_qty ?? 1),
      })),
    })
  } catch (e) {
    return { error: `Угоду створити не вдалося: ${e instanceof Error ? e.message : e}` }
  }

  const { data: created, error } = await service.from('orders').insert({
    external_id: `BX-${dealId}`,
    platform: 'site',
    bitrix_deal_id: dealId,
    order_date: new Date().toISOString().slice(0, 10),
    delivery_date: deliveryDate,
    delivery_slot: deliverySlot,
    warehouse: base.warehouse,
    warehouse_pinned: base.warehouse_pinned,
    delivery_zone: base.delivery_zone,
    area: base.area,
    address: base.address,
    customer_name: base.customer_name,
    customer_phone: base.customer_phone,
    customer_comment: base.customer_comment,
    status: stageName(NEW_STAGE) ?? 'В обробці',
    total,
    commission: 0,
    items: lines
      .map(l => `${l.title}, ${Number(l.ordered_qty)} ${l.unit ?? 'шт'} x ${Number(l.price_per_unit)} грн`)
      .join('\n'),
    share_token: randomBytes(18).toString('base64url'),
  }).select('id').single()

  if (error || !created) {
    return { error: `Угоду створено (#${dealId}), але замовлення — ні: ${error?.message}` }
  }

  await service.from('order_items').insert(lines.map((l, i) => {
    const { id: _id, order_id: _order, created_at: _c, updated_at: _u, position: _p, ...rest } = l
    return { ...rest, order_id: created.id, position: i }
  }))

  /*
   * Вихідні закриваємо.
   *
   * Вони лишаються в системі — з ними пов'язана історія, — але більше
   * нікуди не їдуть, і 1С їх удруге не забере. В аналітиці не рахуються:
   * ті самі гроші вже лежать в об'єднаному.
   */
  const canceled = stageId('Скасовано')
  const sheetNotes: string[] = []
  for (const row of rows) {
    /*
     * Ящик вихідного замовлення вільний.
     *
     * Передзамовлення здебільшого приходять без номера, але не завжди:
     * якщо огляд устиг його видати, після об'єднання цей ящик нікуди не
     * їде. Номер лишався зайнятим до кінця дня — і в журналі, і в аркуші
     * складу, де навпроти нього стояло ім'я людини, якій уже везуть
     * інше.
     */
    if (row.manual_number != null && row.delivery_date) {
      const freed = await releaseNumber(service, {
        number: Number(row.manual_number),
        date: row.delivery_date,
        reason: 'об’єднано в одне замовлення',
      }).catch(() => false)

      // У нашому журналі номер звільнено завжди; тут ідеться про аркуш
      // складу — якщо його не поправили, це має побачити людина
      if (!freed) sheetNotes.push(`№${row.manual_number} у таблиці лишився за старим записом`)
    }

    if (row.bitrix_deal_id && canceled) {
      await updateDealChecked(Number(row.bitrix_deal_id), {
        STAGE_ID: canceled,
        [FIELD.boxNumber]: '',
        COMMENTS: `Об’єднано в угоду #${dealId}`,
      }).catch(() => null)
    }
  }

  await service.from('orders').update({
    status: 'Скасовано',
    cancel_reason: MERGED_REASON,
    moved_to_order_id: created.id,
    manual_number: null,
    auto_done_at: new Date().toISOString(),
    auto_problem: null,
    updated_at: new Date().toISOString(),
  }).in('id', orderIds)

  /*
   * Номер беремо вже після того, як вихідні звільнили свої.
   *
   * Порядок тут важить. Об'єднане замовлення — це той самий покупець і
   * та сама адреса, і на складі воно має стояти там само, де стояли б
   * його частини. Якщо спершу звільнити рядки, найменшим вільним стане
   * саме найменший зі звільнених — і ящик лишиться на своєму місці, а
   * не поїде в кінець дня.
   *
   * Чекати на огляд не випадає: між об'єднанням і проходом минає до
   * трьох хвилин, а оператор уже дивиться на замовлення й питає, який
   * у нього номер.
   */
  const reserved = await reserveNumber(
    service, deliveryDate, base.customer_name ?? 'об’єднане замовлення',
  )

  await service.from('orders')
    .update({ manual_number: reserved.number, number_source: reserved.source })
    .eq('id', created.id)

  await linkNumber(service, {
    date: deliveryDate, number: reserved.number, orderId: created.id as string,
  })

  // Номер ящика склад читає з угоди — там він має з'явитись тієї ж миті
  await updateDealChecked(dealId, { [FIELD.boxNumber]: String(reserved.number) })
    .catch(() => null)

  return {
    orderId: created.id as string,
    dealId,
    merged: rows.length,
    lines: lines.length,
    number: reserved.number,
    numberNote: [reserved.note, ...sheetNotes].filter(Boolean).join('; ') || null,
    from: orderIds.map(id => ({
      deal: rows.find(r => r.id === id)?.bitrix_deal_id ?? null,
      lines: byOrder.get(id)?.length ?? 0,
    })),
  }
}

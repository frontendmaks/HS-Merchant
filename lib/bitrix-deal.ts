/**
 * Ручне замовлення → угода в Бітріксі.
 *
 * Угода складається так само, як її складає сайт: та сама воронка, та сама
 * стадія, ті самі поля й той самий товар доставки. Операторові в CRM не має
 * бути видно, звідки замовлення прийшло — телефоном чи з сайту; видно має
 * бути замовлення.
 */
import { bitrix } from '@/lib/bitrix'
import { slotId } from '@/lib/bitrix-slots'
import { createServiceClient } from '@/lib/supabase/service'
import { BITRIX_DELIVERY_PRODUCT_ID, isDeliveryLine } from '@/lib/delivery-fee'

type Service = ReturnType<typeof createServiceClient>

/** Воронка «Замовлення з НОВОГО САЙТУ» */
export const CATEGORY_ID = 1
/** «В обробці» — стадія, в яку сайт кладе щойно прийняте замовлення */
export const NEW_STAGE = 'C1:PREPARATION'
/** Користувач «Інтернет-магазин», на якого сайт вішає свої замовлення */
export const ASSIGNED_BY = 120

/** Склади: назва в нас → елемент довідника 31 у Бітріксі */
export const WAREHOUSE_ID: Record<string, number> = {
  'Гуртівня онлайн': 7272,
  'АС 2 онлайн': 7273,
  'Санта онлайн': 7433,
  'М 10 онлайн': 7434,
  'МЕ ТТ Іскра': 11974,
  'МЕ ЦУМ онлайн': 12456,
  'МЕ Панська Гора Онлайн': 18256,
}

/** Періоди доставки: наша мітка → значення списку UF_CRM_1606047143435 */
export const FIELD = {
  boxNumber: 'UF_CRM_1607510002583',   // НОМЕР ЯЩИКА — номер із журналу
  warehouse: 'UF_BILL_ADRESS_LIST',
  deliveryDate: 'UF_CRM_1606047095',
  deliverySlot: 'UF_CRM_1606047143435',
  address: 'UF_CRM_1606294264905',
  paymentType: 'UF_PAYMANT_TYPE',
  shipping: 'UF_SHIPPING',
  deliveryCost: 'UF_DELIVERY_COAST',
  orderKey: 'UF_ORDER_KEY',
} as const

/** «Готівка при отриманні» — як платять за телефонне замовлення */
const PAYMENT_CASH = 173
/** «Доставка» — на відміну від самовивозу й Нової Пошти */
const SHIPPING_DELIVERY = 176

interface OrderRow {
  id: string
  external_id: string | null
  manual_number: number | null
  customer_name: string | null
  customer_phone: string | null
  address: string | null
  warehouse: string | null
  delivery_date: string | null
  delivery_slot: string | null
  total: number | null
  operator_comment: string | null
  bitrix_deal_id: number | null
}

interface ItemRow {
  position: number
  title: string
  unit: string
  price_per_unit: number
  ordered_qty: number
  product_id: string | null
  bitrix_product_id: number | null
}

/**
 * Наш товар → товар у каталозі Бітрікса.
 *
 * Спільний ключ — GUID з 1С: у нас `uid_1c`, там `XML_ID`. Знайдені пари
 * лишаються в базі, тож питаємо Бітрікс лише про ті, яких ще не бачили.
 */
export async function productIds(
  service: Service,
  uids: string[],
): Promise<Map<string, number>> {
  const found = new Map<string, number>()
  if (!uids.length) return found

  const { data: cached } = await service
    .from('bitrix_products').select('uid_1c, product_id').in('uid_1c', uids)

  for (const row of cached ?? []) found.set(row.uid_1c as string, Number(row.product_id))

  const missing = uids.filter(u => !found.has(u))
  if (!missing.length) return found

  // Бітрікс віддає не більше 50 за раз — більше в одному замовленні не буває
  const result = await bitrix<{ ID: string; NAME: string; XML_ID: string }[]>(
    'crm.product.list',
    { filter: { XML_ID: missing }, select: ['ID', 'NAME', 'XML_ID'] },
  )

  const fresh = (result ?? []).map(p => ({
    uid_1c: p.XML_ID, product_id: Number(p.ID), name: p.NAME,
  }))
  for (const p of fresh) found.set(p.uid_1c, p.product_id)

  if (fresh.length) {
    await service.from('bitrix_products').upsert(fresh, { onConflict: 'uid_1c' })
  }
  return found
}

/**
 * Контакт клієнта — знайдений за телефоном або створений.
 *
 * Шукаємо саме за номером: ім'я в CRM уже записане так, як його колись
 * почули, і шукати за ним означало б створити другого «Дениса К.» поруч із
 * «Костишиним Денисом».
 */
/**
 * Контакт для угоди: знайти або створити.
 *
 * Без нього угода стоїть із порожнім клієнтом, і в CRM її не знайти ні за
 * іменем, ні за телефоном — а саме так її й шукають.
 */
export async function contactFor(name: string, phone: string): Promise<number | null> {
  try {
    const dup = await bitrix<{ CONTACT?: number[] }>('crm.duplicate.findbycomm', {
      entity_type: 'CONTACT', type: 'PHONE', values: [phone],
    })
    const existing = dup?.CONTACT?.[0]
    if (existing) return Number(existing)

    const parts = name.trim().split(/\s+/)
    return Number(await bitrix<number>('crm.contact.add', {
      fields: {
        LAST_NAME: parts[0] ?? name,
        NAME: parts.slice(1).join(' ') || '',
        PHONE: [{ VALUE: phone, VALUE_TYPE: 'MOBILE' }],
        OPENED: 'Y',
        ASSIGNED_BY_ID: ASSIGNED_BY,
      },
    }))
  } catch {
    // Без контакту угода все одно створиться — ім'я й телефон у ній є
    return null
  }
}

/**
 * Надсилає замовлення в Бітрікс.
 *
 * Якщо угода вже є — оновлює її, а не створює другу: повторний виклик має
 * бути безпечним, бо саме повторний виклик і трапляється, коли щось пішло не
 * так уперше.
 */
export async function pushOrderToBitrix(
  service: Service,
  orderId: string,
): Promise<{ dealId: number } | { error: string }> {
  try {
    const { data: order } = await service
      .from('orders')
      .select('id, external_id, manual_number, customer_name, customer_phone, address, warehouse, delivery_date, delivery_slot, total, operator_comment, bitrix_deal_id')
      .eq('id', orderId).single<OrderRow>()

    if (!order) return { error: 'Замовлення не знайдено' }

    const { data: items } = await service
      .from('order_items')
      .select('position, title, unit, price_per_unit, ordered_qty, product_id, bitrix_product_id')
      .eq('order_id', orderId).eq('removed', false).order('position')

    const lines = (items ?? []) as ItemRow[]

    // GUID-и наших товарів — одним запитом, не рядок за рядком
    const ourIds = lines.map(l => l.product_id).filter(Boolean) as string[]
    const { data: products } = ourIds.length
      ? await service.from('products').select('id, uid_1c').in('id', ourIds)
      : { data: [] }

    const uidByOurId = new Map(
      (products ?? []).filter(p => p.uid_1c).map(p => [p.id as string, p.uid_1c as string]),
    )
    const bitrixByUid = await productIds(service, [...new Set(uidByOurId.values())])

    const rows = lines.map(l => {
      const uid = l.product_id ? uidByOurId.get(l.product_id) : undefined
      const known = uid ? bitrixByUid.get(uid) : undefined
      // Позиція, що прийшла з Бітрікса, вже знає свій товар там — і це
      // точніше за будь-яке зіставлення, бо то його власне число
      const id = isDeliveryLine(l)
        ? BITRIX_DELIVERY_PRODUCT_ID
        : (l.bitrix_product_id ?? known)

      return {
        // Товар без пари в каталозі йде рядком із назвою — замовлення від
        // цього не страждає, а комірник бачить те саме, що й у бланку
        ...(id ? { PRODUCT_ID: id } : {}),
        PRODUCT_NAME: l.title,
        PRICE: Number(l.price_per_unit),
        QUANTITY: Number(l.ordered_qty),
      }
    })

    const delivery = lines.filter(isDeliveryLine)
      .reduce((s, l) => s + Number(l.price_per_unit) * Number(l.ordered_qty), 0)

    const contactId = order.customer_phone && order.customer_name
      ? await contactFor(order.customer_name, order.customer_phone)
      : null

    /*
     * Чим угода народжується — і чим її більше не чіпають.
     *
     * Стадія, воронка, назва й відповідальний належать угоді, а не нашій
     * правці. Поки вони стояли серед звичайних полів, будь-яке
     * збереження замовлення тягнуло стадію назад у «В обробці»:
     * передзамовлення переставало бути передзамовленням, а те, що вже
     * комплектувалось, поверталось на початок. Склад читає стадію з
     * Бітрікса, і такий відкат він сприймав за чисту монету.
     */
    const birth = order.bitrix_deal_id ? {} : {
      TITLE: `Замовлення №${order.manual_number ?? '—'} (телефон)`,
      CATEGORY_ID,
      STAGE_ID: NEW_STAGE,
      ASSIGNED_BY_ID: ASSIGNED_BY,
      OPENED: 'Y',
    }

    const fields: Record<string, unknown> = {
      ...birth,
      CURRENCY_ID: 'UAH',
      /**
       * Суму не передаємо.
       *
       * Бітрікс рахує її з позицій сам, а передана сума вмикає «ручну суму»:
       * у перевірці угода з позицій на 755,70 показала 1400,10 — саме тому,
       * що отримала готове число й не знала, що з ним робити поруч із
       * порахованим. Хай рахує він: позиції однаково головніші.
       */
      /*
       * Порожній коментар не стирає чужого.
       *
       * В угоді з сайту в коментарі лежить те, що написав покупець. Наш
       * порожній рядок затирав його мовчки.
       */
      ...(order.operator_comment ? { COMMENTS: order.operator_comment } : {}),
      ...(contactId ? { CONTACT_ID: contactId } : {}),
      [FIELD.boxNumber]: order.manual_number != null ? String(order.manual_number) : '',
      [FIELD.warehouse]: order.warehouse ? WAREHOUSE_ID[order.warehouse] ?? '' : '',
      [FIELD.deliveryDate]: order.delivery_date ? `${order.delivery_date}T03:00:00+03:00` : '',
      [FIELD.deliverySlot]: await slotId(order.delivery_slot),
      [FIELD.address]: order.address ?? '',
      [FIELD.paymentType]: PAYMENT_CASH,
      [FIELD.shipping]: SHIPPING_DELIVERY,
      [FIELD.deliveryCost]: String(delivery),
      [FIELD.orderKey]: order.external_id ?? '',
    }

    const dealId = order.bitrix_deal_id
      ? (await bitrix<boolean>('crm.deal.update', { id: order.bitrix_deal_id, fields }),
         order.bitrix_deal_id)
      : Number(await bitrix<number>('crm.deal.add', { fields, params: { REGISTER_SONET_EVENT: 'N' } }))

    await bitrix('crm.deal.productrows.set', { id: dealId, rows })

    await service.from('orders')
      .update({ bitrix_deal_id: dealId, bitrix_error: null })
      .eq('id', orderId)

    return { dealId }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    await service.from('orders').update({ bitrix_error: error }).eq('id', orderId)
    return { error }
  }
}

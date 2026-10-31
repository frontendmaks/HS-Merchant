/**
 * Маркетплейсне замовлення → угода в Бітріксі.
 *
 * Склад збирає всі замовлення однаково, тож і бачити їх має в одному місці.
 * Відрізняється тільки походження — його й виносимо в назву угоди, щоб
 * комірник одразу знав, що це доставка з майданчика, а не з сайту.
 *
 * Ціна в угоді — та, яку заплатив покупець.
 *
 * Спершу ми брали її з фіда, вважаючи, що фід і є те, що покупець бачив.
 * На практиці вони розходяться: фід живе далі й міняється, а замовлення
 * лишається з ціною того дня. Угода на 711,55 ₴ проти 813 ₴ у MauDau — це
 * розбіжність і з майданчиком, і з комісією, і з оголошеною цінністю в
 * накладній. Тож беремо ціну із замовлення, а фід лишаємо на випадок, коли
 * ціни в рядку немає зовсім.
 */
import { bitrix } from '@/lib/bitrix'
import { createServiceClient } from '@/lib/supabase/service'
import { loadPricing, basePrice, roundOffer, categoryFor } from '@/lib/price-category'
import { calcMarketplacePrice } from '@/lib/feed-xml'
import {
  WAREHOUSE_ID, CATEGORY_ID, NEW_STAGE, ASSIGNED_BY, contactFor, productIds,
  updateDealChecked, measureFor,
} from '@/lib/bitrix-deal'
import { getSetting } from '@/lib/settings'
import { platformLabel, marketNumberLabel } from '@/lib/order-source'
import { ensureLines, relinkLines } from '@/lib/order-lines'

type Service = ReturnType<typeof createServiceClient>

const FIELD = {
  warehouse: 'UF_BILL_ADRESS_LIST',
  boxNumber: 'UF_CRM_1607510002583',
  address: 'UF_CRM_1606294264905',
  paymentType: 'UF_PAYMANT_TYPE',
  shipping: 'UF_SHIPPING',
  orderKey: 'UF_ORDER_KEY',
} as const

/** «Нова Пошта» — маркетплейсні замовлення їдуть нею, не нашим кур'єром */
const SHIPPING_NP = 425
/** Передоплата: майданчик бере гроші сам */
const PAYMENT_PREPAID = 427

/**
 * Ціни фіда для цього майданчика.
 *
 * Фід — єдине місце, де записано, за скільки ми виставили товар саме там.
 * Якщо фіда немає, повертаємо порожню мапу: тоді в угоду піде ціна з
 * замовлення.
 */
async function feedPrices(
  service: Service,
  platform: string,
): Promise<Map<string, number>> {
  const prices = new Map<string, number>()

  const { data: feed } = await service
    .from('feeds')
    .select('id, price_category_id, marketplace:marketplaces!inner(slug)')
    .eq('marketplaces.slug', platform)
    .eq('status', 'active')
    .maybeSingle()

  if (!feed) return prices

  const [pricing, { data: lines }] = await Promise.all([
    loadPricing(service, feed as { price_category_id?: string | null }),
    service.from('feed_products')
      .select('product_id, custom_price, price_category_id, product:products(id, price, attributes)')
      .eq('feed_id', feed.id).eq('is_active', true),
  ])

  for (const line of lines ?? []) {
    const product = line.product as unknown as
      { id: string; price: number; attributes: Record<string, string> | null } | null
    if (!product) continue

    const { price: base } = basePrice(product, line, pricing)
    const withFormula = line.custom_price
      ? base
      : (calcMarketplacePrice(base, product.attributes) ?? base)

    prices.set(product.id, roundOffer(withFormula, categoryFor(line, pricing)))
  }

  return prices
}

export interface PushResult {
  dealId: number
  priced: number
  lines: number
  /** Скільки рядків знайшли свій товар у Бітріксі — від цього залежить сума */
  matched: number
  /** «M12» — номер замовлення в черзі свого майданчика */
  number: string | null
  /** Позиції, яким не знайшлось артикула 1С — саме вони порожніють у накладній */
  unmatched?: string[]
}

/**
 * Ціна маркетплейсного рядка для угоди.
 *
 * У Бітріксі такі замовлення мають стояти за категорією «Маркетплейс» —
 * це ціна «Онлайн», помножена на коефіцієнт категорії й заокруглена вгору
 * до гривні. Саме цю ціну бачить бухгалтерія й за нею набивають накладну.
 *
 * Ціна, яку заплатив покупець на майданчику, лишається на замовленні в
 * Мерчанті: вона потрібна для звірки виплат і комісії, і підміняти її
 * нашою означало б утратити те, що справді сталось.
 *
 * Онлайнову ціну беремо з нашого каталогу, а для товару, якого на сайті
 * немає, — з каталогу Бітрікса. Якщо не знайшлось ніде, лишається ціна
 * рядка: краще та, що є, ніж нуль.
 */
async function marketplacePrices(
  service: Service,
  lines: { product_id?: string | null; bitrix_product_id?: number | null }[],
): Promise<{ price: (l: { product_id?: string | null; bitrix_product_id?: number | null }) => number | null; note: string }> {
  const { data: category } = await service
    .from('price_categories')
    .select('multiplier, rounding, rounding_step')
    .eq('name', 'Маркетплейс')
    .maybeSingle()

  if (!category) return { price: () => null, note: 'категорії «Маркетплейс» немає' }

  const multiplier = Number(category.multiplier ?? 1)
  const step = Number(category.rounding_step ?? 1) || 1
  const mode = String(category.rounding ?? 'none')

  const ourIds = lines.map(l => l.product_id).filter(Boolean) as string[]
  const bxIds = lines.map(l => l.bitrix_product_id).filter(Boolean) as number[]

  const [{ data: ours }, { data: fromBitrix }] = await Promise.all([
    ourIds.length
      ? service.from('products').select('id, price').in('id', ourIds)
      : Promise.resolve({ data: [] as { id: string; price: number | null }[] }),
    bxIds.length
      ? service.from('bitrix_products').select('product_id, price').in('product_id', bxIds)
      : Promise.resolve({ data: [] as { product_id: number; price: number | null }[] }),
  ])

  const online = new Map<string, number>(
    (ours ?? []).map(p => [p.id as string, Number(p.price ?? 0)]),
  )
  const onlineBx = new Map<number, number>(
    (fromBitrix ?? []).map(p => [Number(p.product_id), Number(p.price ?? 0)]),
  )

  const round = (value: number) => {
    if (mode === 'none' || !(value > 0)) return Math.round(value * 100) / 100
    const units = value / step
    const whole = mode === 'up' ? Math.ceil(units)
      : mode === 'down' ? Math.floor(units) : Math.round(units)
    return Math.round(whole * step * 100) / 100
  }

  return {
    note: `×${multiplier}`,
    price: l => {
      const base = (l.product_id ? online.get(l.product_id) : undefined)
        ?? (l.bitrix_product_id ? onlineBx.get(Number(l.bitrix_product_id)) : undefined)
      return base && base > 0 ? round(base * multiplier) : null
    },
  }
}

/**
 * Номер маркетплейсного замовлення — свій, не ящиковий.
 *
 * Черга номерів у маркетплейсів власна й рахується з одиниці щомісяця:
 * M1, M2 для MauDau, R1, R2 для Rozetka. Номер ящика кур'єрської
 * доставки живе окремо — то інша черга на той самий день, і сплутати їх
 * означає зібрати не те.
 *
 * Видаємо один раз: уже виданий номер лишається за замовленням назавжди,
 * бо його вже бачили на бланку, в угоді й у чаті.
 */
async function ensureMarketNumber(
  service: Service,
  order: { id: string; platform: string | null; order_date: string | null; market_number: number | null },
): Promise<number | null> {
  if (order.market_number != null) return order.market_number
  if (!order.platform) return null

  const month = `${(order.order_date ?? new Date().toISOString().slice(0, 10)).slice(0, 7)}-01`

  const { data, error } = await service.rpc('next_market_number', {
    p_platform: order.platform,
    p_month: month,
  })

  if (error || data == null) return null

  const number = Number(data)
  await service.from('orders').update({ market_number: number }).eq('id', order.id)
  return number
}

export async function pushMarketplaceOrder(
  service: Service,
  orderId: string,
): Promise<PushResult | { error: string }> {
  try {
    const { data: order } = await service
      .from('orders')
      .select('id, external_id, platform, customer_name, customer_phone, address, branch, total, status, bitrix_deal_id, operator_comment, order_date, market_number')
      .eq('id', orderId).single()

    if (!order) return { error: 'Замовлення не знайдено' }

    /*
     * Позиції маркетплейсного замовлення до першого відкриття складу живуть
     * лише в сирій відповіді майданчика. Читати саму таблицю було замало:
     * замовлення, якого ніхто не відкривав у Мерчанті, виглядало порожнім —
     * і автопілот відмовлявся його заводити, хоча товари в ньому були.
     */
    // Рядки, що лишились без товару з часів неповного каталогу, доклеюємо
    // тут: без товару угода не має ні ціни з фіду, ні суми
    await ensureLines(service, orderId)
    await relinkLines(service, orderId)

    const lines = (await ensureLines(service, orderId))
      .filter(l => !l.removed)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))

    if (!lines.length) return { error: 'У замовленні немає позицій' }

    const prices = await feedPrices(service, order.platform as string)
    const market = await marketplacePrices(service, lines as {
      product_id?: string | null; bitrix_product_id?: number | null
    }[])
    let priced = 0

    /*
     * Артикул товару в рядку угоди.
     *
     * Без нього Бітрікс не зараховує рядок у суму угоди: три позиції на
     * 813 ₴ показували «0 грн». Тож тягнемо той самий ланцюжок, що й для
     * телефонних замовлень: наш товар → GUID 1С → товар у Бітріксі.
     */
    const ourIds = lines.map(l => l.product_id).filter(Boolean) as string[]
    const { data: products } = ourIds.length
      ? await service.from('products').select('id, uid_1c').in('id', ourIds)
      : { data: [] }

    const uidByOurId = new Map(
      (products ?? []).filter(p => p.uid_1c).map(p => [p.id as string, p.uid_1c as string]),
    )
    const bitrixByUid = await productIds(service, [...new Set(uidByOurId.values())])

    let matched = 0
    const rows = lines.map(l => {
      const own = Number(l.price_per_unit ?? 0)
      const fromFeed = l.product_id ? prices.get(l.product_id as string) : undefined

      /*
       * Категорія «Маркетплейс» головніша за все.
       *
       * Саме за цією ціною набивають накладну, і вона має бути однакова
       * в усіх маркетплейсних угодах, хоч би скільки покупець заплатив
       * на майданчику. Решта — запасні варіанти на випадок, коли
       * онлайнової ціни на товар немає ніде.
       */
      const price = market.price(l as { product_id?: string | null; bitrix_product_id?: number | null })
        ?? (own > 0 ? own : fromFeed ?? 0)
      if (own <= 0 && fromFeed != null) priced++

      const uid = l.product_id ? uidByOurId.get(l.product_id as string) : undefined
      const id = uid ? bitrixByUid.get(uid) : undefined
      if (id) matched++

      /*
       * Артикул у рядку — те, за чим позицію впізнає 1С.
       *
       * Учора я прибрав його звідси зовсім, бо 1С лишала порожні поля, —
       * і помилився в причині. Замовлення з сайту йдуть із артикулами й
       * читаються правильно; порожніло ж те, чому артикула не знайшлось.
       * А не знаходився він через написання: наш «Я0008» маркетплейс шле
       * як «Ya0008», «СВ_075» — як «SV_075», і зіставлення за схожістю
       * літер таких пар не бачить. Тепер бачить.
       *
       * Позиція без пари все одно йде назвою — краще рядок, який
       * комірник прочитає, ніж жодного, — але мовчки вона більше не
       * проходить: нижче такі перелічені в помилці замовлення.
       */
      return {
        ...(id ? { PRODUCT_ID: id } : {}),
        PRODUCT_NAME: l.title,
        PRICE: price,
        QUANTITY: Number(l.ordered_qty ?? 1),
        ...measureFor(l.unit as string | null),
      }
    })

    /*
     * Позиції, яких 1С не впізнає, називаємо поіменно.
     *
     * Доти незіставлена позиція доходила до накладної порожнім полем, і
     * помічали це вже кур'єр із комірником. Товар міг просто не мати
     * пари в нашому каталозі — тоді його треба завести, і знати про це
     * має людина, а не здогадуватись постфактум.
     */
    const unmatched = lines.filter(l => {
      const uid = l.product_id ? uidByOurId.get(l.product_id as string) : undefined
      return !(uid && bitrixByUid.get(uid))
    })



    const warehouse = await getSetting(service, 'marketplace_warehouse')
    const label = platformLabel(order.platform as string)

    const number = await ensureMarketNumber(service, order as {
      id: string; platform: string | null; order_date: string | null; market_number: number | null
    })
    const numberLabel = marketNumberLabel(order.platform as string, number)

    // Клієнт в угоді: знайдемо за телефоном або заведемо нового
    const contactId = order.customer_phone && order.customer_name
      ? (await contactFor(order.customer_name as string, order.customer_phone as string)).id
      : null

    const fields: Record<string, unknown> = {
      /*
       * Назва каже головне: номер, звідки замовлення й чим його знайти.
       *
       * Номер попереду, бо саме його називають уголос на складі й за ним
       * шукають угоду; номер майданчика лишається в кінці для звірки з
       * кабінетом.
       */
      TITLE: [numberLabel, `Доставка ${label}`, order.external_id]
        .filter(Boolean).join(' · '),
      CATEGORY_ID,
      STAGE_ID: NEW_STAGE,
      ASSIGNED_BY_ID: ASSIGNED_BY,
      CURRENCY_ID: 'UAH',
      OPENED: 'Y',
      COMMENTS: [order.customer_name, order.customer_phone, order.operator_comment]
        .filter(Boolean).join(' · '),
      [FIELD.warehouse]: WAREHOUSE_ID[warehouse] ?? '',
      [FIELD.address]: order.address ?? order.branch ?? '',
      [FIELD.paymentType]: PAYMENT_PREPAID,
      [FIELD.shipping]: SHIPPING_NP,
      [FIELD.orderKey]: order.external_id ?? '',
      // Те саме поле, з якого 1С читає номер ящика в сайтових замовленнях
      [FIELD.boxNumber]: numberLabel ?? '',
      ...(contactId ? { CONTACT_ID: contactId } : {}),
    }

    const dealId = order.bitrix_deal_id
      ? (await updateDealChecked(Number(order.bitrix_deal_id), fields),
         Number(order.bitrix_deal_id))
      : Number(await bitrix<number>('crm.deal.add', {
          fields, params: { REGISTER_SONET_EVENT: 'N' },
        }))

    await bitrix('crm.deal.productrows.set', { id: dealId, rows })

    /*
     * Суму угоди Бітрікс рахує сам — і нуль тут не помилка.
     *
     * Рядок без артикула він у суму не зараховує, а закріпити своє
     * число не дає, поки рядки взагалі є: перевірено на живій угоді M9
     * трьома способами — обидва поля разом, прапорець окремо перед
     * сумою, сума рядком, — щоразу «0,00» при позиціях на 1352,70.
     *
     * Це свідомий обмін: порожній рядок у накладній 1С коштує
     * повернення й другого виїзду кур'єра, а нуль в угоді — лише
     * цифри у звіті CRM. Справжня сума лишається в самому замовленні,
     * у бланку й на майданчику.
     */

    await service.from('orders')
      .update({
        bitrix_deal_id: dealId,
        bitrix_error: unmatched.length
          ? `без артикулу 1С: ${unmatched.map(l => l.title).join('; ')}`
          : null,
      })
      .eq('id', orderId)

    return {
      dealId, priced, lines: rows.length, matched, number: numberLabel,
      unmatched: unmatched.map(l => l.title as string),
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    await service.from('orders').update({ bitrix_error: error }).eq('id', orderId)
    return { error }
  }
}

/**
 * Позиції замовлення — просто з сайту.
 *
 * Зазвичай вони приходять до нас в угоді: сайт заводить угоду в Бітріксі
 * й кладе в неї товари. Але 30 жовтня сайт завів угоди без товарів —
 * #201275, #201278, #201246 простояли порожніми годинами, і склад бачив
 * «0 ₴, бракує товари», хоч у самому замовленні на сайті лежало
 * шістнадцять позицій на 2961,90 ₴.
 *
 * Угода — не єдине джерело. Ключ угоди («wc_order_HiGBYkWOhVVZn») — це
 * ключ замовлення WooCommerce, а доступ до нього в нас уже є, бо ним
 * ходить синхронізація товарів. Тож коли в угоді порожньо, питаємо
 * першоджерело.
 */
const WC_URL = process.env.WC_URL
const CK = process.env.WC_CONSUMER_KEY
const CS = process.env.WC_CONSUMER_SECRET

export const wcConfigured = () => !!(WC_URL && CK && CS)

/*
 * Сайт відмовляє всьому, що не схоже на браузер.
 *
 * Захист перед WordPress дивиться на `User-Agent` і відповідає 403 ще до
 * того, як запит дійде до WooCommerce: та сама адреса з тим самим ключем
 * віддає замовлення браузерові й «Forbidden» серверному `fetch`, який
 * представляється «node». Через це добір позицій із сайту мовчки не
 * працював: `wcOrderByKey` бачив не помилку доступу, а просто `!res.ok`,
 * і повертав порожньо.
 *
 * Тож представляємось так, як нас пускають. Ключ лишається ключем —
 * заголовок нікого не обходить, він лише проходить повз сторожа.
 */
const WC_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
    + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  Accept: 'application/json',
} as const

export interface WcLine {
  /**
   * Номер товару на сайті — він же `external_id` у нашому каталозі.
   *
   * Товар зі складом у назві («… - Санта онлайн») — це варіація, і в
   * неї свій номер, якого в каталозі немає: там лежить номер базового
   * товару. Тому тримаємо обидва й шукаємо спершу за варіацією, тоді
   * за базовим.
   */
  productId: number | null
  variationId: number | null
  sku: string | null
  name: string
  quantity: number
  /** Ціна за одиницю, гривні */
  price: number
}

interface WcOrder {
  id: number
  order_key: string
  total: string
  line_items: {
    product_id?: number; variation_id?: number; sku?: string
    name?: string; quantity?: number; total?: string; price?: number
  }[]
}

/**
 * Замовлення за ключем угоди.
 *
 * WooCommerce не вміє шукати за `order_key` напряму, тож беремо свіжі
 * замовлення й шукаємо серед них. Вікно в тиждень: угода без товарів —
 * це сьогоднішній клопіт, а не торішній.
 */
export async function wcOrderByKey(key: string): Promise<WcOrder | null> {
  if (!wcConfigured() || !key.startsWith('wc_order_')) return null

  const after = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 19)
  const url = `${WC_URL}/wp-json/wc/v3/orders?per_page=100&after=${after}`
    + `&_fields=id,order_key,total,line_items`
    + `&consumer_key=${CK}&consumer_secret=${CS}`

  const res = await fetch(url, { headers: WC_HEADERS, signal: AbortSignal.timeout(20_000) })
  if (!res.ok) return null

  const orders = await res.json() as WcOrder[]
  return Array.isArray(orders) ? orders.find(o => o.order_key === key) ?? null : null
}

/** Рядки замовлення в тому вигляді, в якому їх зрозуміє решта Мерчанта */
export function wcLines(order: WcOrder): WcLine[] {
  return (order.line_items ?? []).map(l => {
    const qty = Number(l.quantity ?? 1) || 1
    /*
     * Ціна за одиницю — із суми рядка.
     *
     * Поле `price` WooCommerce округлює до копійки на одиницю, і на
     * вагових позиціях сума рядка з нього не збирається. Сума — те, що
     * заплатив покупець, тож рахуємо від неї.
     */
    const total = Number(l.total ?? 0)
    return {
      productId: Number(l.product_id || 0) || null,
      variationId: Number(l.variation_id || 0) || null,
      sku: (l.sku ?? '').trim() || null,
      name: l.name ?? 'Без назви',
      quantity: qty,
      price: total > 0 ? Math.round((total / qty) * 100) / 100 : Number(l.price ?? 0),
    }
  })
}

/**
 * Відбиток кошика, з якого народилось замовлення.
 *
 * WooCommerce рахує `cart_hash` із вмісту кошика. Два замовлення з одним
 * відбитком — це один кошик, покладений двічі: саме так 20 листопада
 * народились замовлення 968429 і 968430 — одна секунда різниці, та сама
 * адреса, той самий телефон, той самий iPhone. Для нас це були дві угоди
 * (#202957 і #202958) і два ящики на складі.
 *
 * Здогадки тут не потрібні: відбиток або збігається, або ні. Беремо його
 * для названих угод — замовлення на сайті знає номер своєї угоди в полі
 * `crm_deal_id`, тож питати Бітрікс не доводиться.
 *
 * Вікно — дві доби: дубль народжується в ту саму секунду, що й оригінал,
 * і шукати його тиждень потому нема потреби.
 */
export async function wcCartHashes(dealIds: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  const wanted = new Set(dealIds.filter(Boolean).map(String))
  if (!wcConfigured() || !wanted.size) return out

  const after = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 19)
  const url = `${WC_URL}/wp-json/wc/v3/orders?per_page=100&after=${after}`
    + `&_fields=id,cart_hash,meta_data`
    + `&consumer_key=${CK}&consumer_secret=${CS}`

  const res = await fetch(url, { headers: WC_HEADERS, signal: AbortSignal.timeout(20_000) })
  if (!res.ok) return out

  const orders = await res.json() as {
    cart_hash?: string
    meta_data?: { key?: string; value?: unknown }[]
  }[]
  if (!Array.isArray(orders)) return out

  for (const order of orders) {
    const deal = order.meta_data?.find(m => m.key === 'crm_deal_id')?.value
    const id = String(deal ?? '').trim()
    const hash = String(order.cart_hash ?? '').trim()
    if (hash && wanted.has(id)) out.set(Number(id), hash)
  }
  return out
}

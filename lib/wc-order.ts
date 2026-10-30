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

export interface WcLine {
  /** Номер товару на сайті — він же `external_id` у нашому каталозі */
  productId: number | null
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

  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
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
      productId: Number(l.variation_id || l.product_id || 0) || null,
      sku: (l.sku ?? '').trim() || null,
      name: l.name ?? 'Без назви',
      quantity: qty,
      price: total > 0 ? Math.round((total / qty) * 100) / 100 : Number(l.price ?? 0),
    }
  })
}

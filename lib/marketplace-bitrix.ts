/**
 * Маркетплейсне замовлення → угода в Бітріксі.
 *
 * Склад збирає всі замовлення однаково, тож і бачити їх має в одному місці.
 * Відрізняється тільки походження — його й виносимо в назву угоди, щоб
 * комірник одразу знав, що це доставка з майданчика, а не з сайту.
 *
 * Ціну беремо з фіда: саме її бачив покупець на майданчику, і саме вона має
 * стояти в угоді. Там, де товар не вдалося зіставити з каталогом, лишаємо
 * ціну, яку порахував сам майданчик — вона теж правдива, просто прийшла з
 * іншого боку.
 */
import { bitrix } from '@/lib/bitrix'
import { createServiceClient } from '@/lib/supabase/service'
import { loadPricing, basePrice, roundOffer, categoryFor } from '@/lib/price-category'
import { calcMarketplacePrice } from '@/lib/feed-xml'
import { WAREHOUSE_ID, CATEGORY_ID, NEW_STAGE, ASSIGNED_BY } from '@/lib/bitrix-deal'
import { getSetting } from '@/lib/settings'
import { platformLabel } from '@/lib/order-source'
import { ensureLines } from '@/lib/order-lines'

type Service = ReturnType<typeof createServiceClient>

const FIELD = {
  warehouse: 'UF_BILL_ADRESS_LIST',
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

export interface PushResult { dealId: number; priced: number; lines: number }

export async function pushMarketplaceOrder(
  service: Service,
  orderId: string,
): Promise<PushResult | { error: string }> {
  try {
    const { data: order } = await service
      .from('orders')
      .select('id, external_id, platform, customer_name, customer_phone, address, branch, total, status, bitrix_deal_id, operator_comment')
      .eq('id', orderId).single()

    if (!order) return { error: 'Замовлення не знайдено' }

    /*
     * Позиції маркетплейсного замовлення до першого відкриття складу живуть
     * лише в сирій відповіді майданчика. Читати саму таблицю було замало:
     * замовлення, якого ніхто не відкривав у Мерчанті, виглядало порожнім —
     * і автопілот відмовлявся його заводити, хоча товари в ньому були.
     */
    const lines = (await ensureLines(service, orderId))
      .filter(l => !l.removed)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))

    if (!lines.length) return { error: 'У замовленні немає позицій' }

    const prices = await feedPrices(service, order.platform as string)
    let priced = 0

    const rows = lines.map(l => {
      const fromFeed = l.product_id ? prices.get(l.product_id as string) : undefined
      if (fromFeed != null) priced++
      return {
        PRODUCT_NAME: l.title,
        PRICE: fromFeed ?? Number(l.price_per_unit ?? 0),
        QUANTITY: Number(l.ordered_qty ?? 1),
      }
    })

    const warehouse = await getSetting(service, 'marketplace_warehouse')
    const label = platformLabel(order.platform as string)

    const fields: Record<string, unknown> = {
      // Назва каже головне: це доставка, і звідки вона прийшла
      TITLE: `Доставка ${label} · ${order.external_id}`,
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
    }

    const dealId = order.bitrix_deal_id
      ? (await bitrix('crm.deal.update', { id: order.bitrix_deal_id, fields }),
         Number(order.bitrix_deal_id))
      : Number(await bitrix<number>('crm.deal.add', {
          fields, params: { REGISTER_SONET_EVENT: 'N' },
        }))

    await bitrix('crm.deal.productrows.set', { id: dealId, rows })
    await service.from('orders')
      .update({ bitrix_deal_id: dealId, bitrix_error: null }).eq('id', orderId)

    return { dealId, priced, lines: rows.length }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    await service.from('orders').update({ bitrix_error: error }).eq('id', orderId)
    return { error }
  }
}

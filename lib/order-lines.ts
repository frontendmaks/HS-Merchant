/**
 * Рядки замовлення: від того, що прислав маркетплейс, до того, що можна правити.
 *
 * Маркетплейс тримає позиції всередині свого сирого відповіді, і до першого
 * відкриття складу в нас немає жодного рядка. Раніше їх створював лише
 * редактор складу — а отже замовлення, якого не відкривав оператор, виглядало
 * для будь-кого іншого порожнім. Інтеграції це видно одразу: Бітрікс отримував
 * би замовлення без товарів.
 *
 * Тому матеріалізація живе тут, а не в маршруті редактора: обидва входи мають
 * бачити те саме.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
import {
  buildLine, indexCatalog,
  type CatalogProduct, type MarketplaceLine, type OrderLine,
} from '@/lib/order-items'

type Service = ReturnType<typeof createServiceClient>

export async function loadCatalog(service: Service) {
  /*
   * Сторінками, а не одним запитом.
   *
   * PostgREST обрізає відповідь на тисячі рядків і мовчить про це —
   * `.limit(5000)` його не стосується. Каталог має дві тисячі товарів, тож
   * половина для зіставлення просто не існувала: рядок замовлення не
   * знаходив свого товару, лишався без артикулу, а в Бітріксі угода з
   * таких рядків показувала суму 0 ₴.
   */
  const data = await fetchAllRows(() => service
    .from('products')
    .select('id, name, sku, external_id, price, attributes, uid_1c'))
  return indexCatalog((data ?? []) as unknown as CatalogProduct[])
}

/** The order's lines as the marketplace sent them. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function marketplaceLines(order: any): MarketplaceLine[] {
  const out: MarketplaceLine[] = []

  if (order.platform === 'maudau') {
    for (const parcel of order.raw?.parcels ?? []) {
      for (const it of parcel.items ?? []) {
        out.push({
          itemId: it.id != null ? String(it.id) : null,
          externalId: it.product?.external_id ?? null,
          title: it.product?.title_uk || it.product?.title || 'Без назви',
          unitPrice: (it.price ?? 0) / 100,   // MauDau quotes kopecks
          quantity: Number(it.quantity ?? 1),
        })
      }
    }
  } else if (order.platform === 'prom') {
    for (const p of order.raw?.products ?? []) {
      /* Prom віддає наш же код товару в external_id позиції — той самий,
         що ми кладемо у фід. Його й беремо; id позиції — запасний */
      const code = [p.external_id, p.sku, p.id]
        .map(v => (v == null ? '' : String(v).trim())).find(v => v !== '')

      out.push({
        itemId: p.id != null ? String(p.id) : null,
        externalId: code || null,
        /* Українська назва, а не `name`: та — російська, і на старих
           картках Prom вона буває зіпсована («Сало канапковое “íнская”»
           замість «Мексиканське»). Склад читає українською */
        title: p.name_multilang?.uk || p.name || 'Без назви',
        unitPrice: Number(String(p.price ?? 0).replace(/[^\d.,-]/g, '').replace(',', '.')) || 0,
        quantity: Number(p.quantity ?? 1),
      })
    }
  } else if (order.platform === 'rozetka') {
    for (const p of order.raw?.purchases ?? []) {
      /*
       * Код товару Rozetka віддає в price_offer_id — тому самому, під яким
       * ми завели картку. `article` у відповіді **порожній рядок**, а не
       * відсутність, і доти його брали першим: `??` порожнього рядка не
       * пропускає, тож умова ставала хибною і код виходив `null`. Для
       * кожної позиції, усі тридцять шість: жодна не знайшла свого товару,
       * а без товару немає ні коду 1С, ні ціни — склад отримав би назву й
       * порожню номенклатуру.
       *
       * Тож беремо перше непорожнє, а не перше не-null.
       */
      const code = [
        p.item?.price_offer_id,
        p.item?.uploader_offer_id,
        p.item?.article,
        p.item_id,
      ].map(v => (v == null ? '' : String(v).trim())).find(v => v !== '')

      out.push({
        itemId: p.id != null ? String(p.id) : null,
        externalId: code || null,
        title: p.item_name || 'Без назви',
        unitPrice: Number(p.price_with_discount ?? p.price ?? 0),
        quantity: Number(p.quantity ?? 1),
      })
    }
  }
  return out
}

/** Materialises the lines on first open; afterwards the stored copy wins. */
export async function ensureLines(
  service: Service,
  orderId: string,
  /**
   * Готовий каталог, якщо викликач уже його має.
   *
   * Без цього сторінка на двісті замовлень вантажила довідник двісті разів —
   * по п'ять тисяч товарів щоразу. Для одного замовлення різниці немає, для
   * вибірки вона вирішальна.
   */
  prepared?: Awaited<ReturnType<typeof loadCatalog>>,
): Promise<OrderLine[]> {
  const { data: stored } = await service
    .from('order_items').select('*').eq('order_id', orderId).order('position')

  if (stored && stored.length) return stored as unknown as OrderLine[]

  const { data: order } = await service
    .from('orders').select('id, platform, raw').eq('id', orderId).single()
  if (!order) return []

  const catalog = prepared ?? await loadCatalog(service)
  const lines = marketplaceLines(order).map((l, i) => buildLine(l, catalog, i))
  if (!lines.length) return []

  const { data: inserted, error } = await service
    .from('order_items')
    .insert(lines.map(l => ({ ...l, order_id: orderId })))
    .select('*')

  if (error) {
    console.error('ensureLines insert failed:', error.message)
    return lines
  }
  return (inserted ?? []) as unknown as OrderLine[]
}

/**
 * Доклеює товар до рядків, які лишились без нього.
 *
 * Рядок запам'ятовує свій товар один раз — коли склад уперше відкриває
 * замовлення. Якщо тоді каталог був неповний, рядок лишався без товару
 * назавжди: ні ціни з фіду, ні артикулу в угоді. Перезіставляти щоразу
 * марно, а один раз — рівно те, чого бракує.
 *
 * Чіпаємо лише порожнє: товар, якого склад уже виправив руками,
 * переписувати не можна.
 */
export async function relinkLines(
  service: Service,
  orderId: string,
  prepared?: Awaited<ReturnType<typeof loadCatalog>>,
): Promise<number> {
  const { data } = await service
    .from('order_items')
    .select('id, product_external_id, title')
    .eq('order_id', orderId)
    .is('product_id', null)

  const orphans = data ?? []
  if (!orphans.length) return 0

  const catalog = prepared ?? await loadCatalog(service)
  let linked = 0

  for (const row of orphans) {
    const product = catalog.find(row.product_external_id as string | null, row.title as string | null)
    if (!product) continue
    await service.from('order_items').update({ product_id: product.id }).eq('id', row.id)
    linked++
  }

  return linked
}

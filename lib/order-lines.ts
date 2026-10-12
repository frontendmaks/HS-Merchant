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
import {
  buildLine, indexCatalog,
  type CatalogProduct, type MarketplaceLine, type OrderLine,
} from '@/lib/order-items'

type Service = ReturnType<typeof createServiceClient>

export async function loadCatalog(service: Service) {
  const { data } = await service
    .from('products')
    .select('id, name, sku, external_id, price, attributes')
    .limit(5000)
  return indexCatalog((data ?? []) as CatalogProduct[])
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
  } else if (order.platform === 'rozetka') {
    for (const p of order.raw?.purchases ?? []) {
      out.push({
        itemId: p.id != null ? String(p.id) : null,
        externalId: p.item?.article ?? p.item_id != null ? String(p.item?.article ?? p.item_id) : null,
        title: p.item_name || 'Без назви',
        unitPrice: Number(p.price_with_discount ?? p.price ?? 0),
        quantity: Number(p.quantity ?? 1),
      })
    }
  }
  return out
}

/** Materialises the lines on first open; afterwards the stored copy wins. */
export async function ensureLines(service: Service, orderId: string): Promise<OrderLine[]> {
  const { data: stored } = await service
    .from('order_items').select('*').eq('order_id', orderId).order('position')

  if (stored && stored.length) return stored as unknown as OrderLine[]

  const { data: order } = await service
    .from('orders').select('id, platform, raw').eq('id', orderId).single()
  if (!order) return []

  const catalog = await loadCatalog(service)
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

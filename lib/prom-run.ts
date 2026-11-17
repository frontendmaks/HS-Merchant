/**
 * Ціни й залишки на Prom — щогодини, а не раз на чотири.
 *
 * Фід Prom забирає сам раз на чотири години, і цього досить для опису,
 * фото й нових товарів. Але залишок за чотири години встигає збрехати:
 * останню пачку продають в обох місцях, і хтось лишається без неї.
 *
 * Тому ціну й залишок додатково штовхаємо через API — єдине, що воно
 * вміє міняти в наявному товарі. Решта картки лишається за фідом, щоб
 * в одного поля не було двох господарів.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { loadPricing } from '@/lib/price-category'
import { loadPromos, promoFor, oldPriceFor } from '@/lib/price-promo'
import { basePrice, roundOffer, categoryFor } from '@/lib/price-category'
import { calcMarketplacePrice, offerStock } from '@/lib/feed-xml'
import { attrsFor } from '@/lib/product-content'
import { promProducts, promUpdateProducts, type PromPriceUpdate } from '@/lib/prom-api'

type Service = ReturnType<typeof createServiceClient>

export interface PromRunResult {
  looked: number
  updated: number
  unchanged: number
  missing: number
  errors: string[]
}

/** Чи змінилось так, що варто турбувати Prom. Копійки й нулі — ні. */
const differs = (a: number | null | undefined, b: number | null | undefined) =>
  Math.abs(Number(a ?? 0) - Number(b ?? 0)) > 0.009

export async function pushPromPrices(service: Service): Promise<PromRunResult> {
  const out: PromRunResult = { looked: 0, updated: 0, unchanged: 0, missing: 0, errors: [] }

  const { data: feed } = await service
    .from('feeds')
    .select('id, settings, price_category_id, marketplace:marketplaces!inner(slug)')
    .eq('marketplaces.slug', 'prom')
    .limit(1)
    .maybeSingle()

  if (!feed) throw new Error('Фіда Prom немає — нема з чого рахувати')

  const { data: rows } = await service
    .from('feed_products')
    .select('id, is_active, custom_price, custom_stock, price_category_id, product:products(*)')
    .eq('feed_id', (feed as { id: string }).id)
    .eq('is_active', true)
    .limit(5000)

  const active = (rows ?? []).filter(r => r.product)
  out.looked = active.length
  if (!active.length) return out

  const [pricing, promos] = await Promise.all([
    loadPricing(service, feed as { price_category_id?: string | null }),
    loadPromos(service, (feed as { id: string }).id),
  ])

  /* Prom знає товар за своїм id; зчіпка — наш external_id, той самий,
     під яким товар поїхав у фіді */
  const onProm = await promProducts()
  const byCode = new Map(
    onProm.filter(p => p.external_id).map(p => [String(p.external_id).trim(), p]),
  )

  const batch: PromPriceUpdate[] = []

  for (const fp of active) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = fp.product as any
    const code = String(p.external_id ?? '').trim()
    const live = code ? byCode.get(code) : undefined
    if (!live) { out.missing++; continue }

    const attrs = attrsFor(p)
    const { price: base } = basePrice(p, fp, pricing)
    const offer = fp.custom_price ? base : (calcMarketplacePrice(base, attrs) ?? base)
    const price = roundOffer(offer, categoryFor(fp, pricing))
    if (!(price > 0)) continue

    /* Ціна в Prom — це закреслена, «до знижки»: саме її ми й віддаємо,
       бо знижку Prom малює сам із пари ціна/стара ціна */
    const realOld = p.price_old && Number(p.price_old) > Number(p.price)
      ? (calcMarketplacePrice(Number(p.price_old), attrs) ?? Number(p.price_old))
      : null
    const shown = oldPriceFor(price, realOld, promoFor(promos ?? [], p)) ?? price

    const raw = Number(fp.custom_stock ?? p.stock ?? 0)
    const { available, quantity } = offerStock(p.status, raw)
    const stock = Math.max(0, Math.floor(quantity ?? 0))
    const presence: 'available' | 'not_available' = available ? 'available' : 'not_available'

    const same =
      !differs(live.price as number, shown) &&
      live.presence === presence &&
      Number(live.quantity_in_stock ?? 0) === stock

    if (same) { out.unchanged++; continue }

    batch.push({ id: live.id, price: shown, presence, quantity_in_stock: stock })
  }

  /* Пачками: Prom бере список, і сотня за раз лягає впевнено */
  for (let i = 0; i < batch.length; i += 100) {
    const chunk = batch.slice(i, i + 100)
    try {
      out.updated += await promUpdateProducts(chunk)
    } catch (e) {
      out.errors.push(e instanceof Error ? e.message : String(e))
    }
  }

  return out
}

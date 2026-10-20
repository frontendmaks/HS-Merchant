/**
 * Яку ціну віддавати маркетплейсу.
 *
 * Та сама позиція коштує по-різному залежно від того, де її продають, тож
 * «ціна товару» — питання з двома відповідями. Категорія каже, звідки взяти
 * базову ціну й на що її помножити; далі з нею працює звичайна формула
 * фасування.
 *
 * Порядок переважання такий, щоб точніше рішення завжди перемагало:
 * вписана руками ціна товару → категорія, обрана цьому товару → категорія
 * фіда → каталожна ціна. Інакше загальне правило мовчки перекривало б
 * окремий випадок, заради якого його й заводили.
 */
// Тип, не значення: цей модуль використовує і браузер, а службовий
// клієнт туди потрапити не має
import type { createServiceClient } from '@/lib/supabase/service'

type Service = ReturnType<typeof createServiceClient>

export interface PriceCategory {
  id: string
  name: string
  source: 'site' | 'bitrix'
  bitrix_price_type_id: number | null
  multiplier: number
  is_system: boolean
  rounding: 'none' | 'up' | 'down' | 'nearest'
  rounding_step: number
}

export interface PricingContext {
  feedCategory: PriceCategory | null
  byId: Map<string, PriceCategory>
  /** Ціни з Бітрікса: товар → тип ціни → ціна */
  bitrixPrices: Map<string, Map<number, number>>
}

export async function loadPricing(
  service: Service,
  feed: { price_category_id?: string | null },
): Promise<PricingContext> {
  const { data: categories } = await service
    .from('price_categories')
    .select('id, name, source, bitrix_price_type_id, multiplier, is_system, rounding, rounding_step')

  const byId = new Map<string, PriceCategory>()
  for (const c of categories ?? []) {
    byId.set(c.id as string, {
      ...c,
      multiplier: Number(c.multiplier),
      rounding_step: Number(c.rounding_step ?? 1),
    } as PriceCategory)
  }

  // Ціни з Бітрікса тягнемо лише тоді, коли хоч одна категорія з них живе
  const typeIds = [...byId.values()]
    .filter(c => c.source === 'bitrix' && c.bitrix_price_type_id != null)
    .map(c => c.bitrix_price_type_id as number)

  const bitrixPrices = new Map<string, Map<number, number>>()
  if (typeIds.length) {
    const { data: prices } = await service
      .from('product_prices')
      .select('product_id, price_type_id, price')
      .in('price_type_id', [...new Set(typeIds)])

    for (const row of prices ?? []) {
      const key = row.product_id as string
      const forProduct = bitrixPrices.get(key) ?? new Map<number, number>()
      forProduct.set(Number(row.price_type_id), Number(row.price))
      bitrixPrices.set(key, forProduct)
    }
  }

  return {
    feedCategory: feed.price_category_id ? byId.get(feed.price_category_id) ?? null : null,
    byId,
    bitrixPrices,
  }
}

/** Категорія, за якою рахується ціна цього рядка фіда. */
export function categoryFor(
  line: { price_category_id?: string | null },
  ctx: PricingContext,
): PriceCategory | null {
  return (line.price_category_id ? ctx.byId.get(line.price_category_id) : null) ?? ctx.feedCategory
}

/**
 * Заокруглення готової ціни пропозиції.
 *
 * Саме готової: між базовою ціною й ціною у фіді стоїть формула фасування,
 * і заокруглена ціна за кілограм після множення на 0.4 знову перестає бути
 * круглою. Округляємо те число, яке побачить покупець.
 */
export function roundOffer(price: number, category: PriceCategory | null): number {
  if (!category || category.rounding === 'none' || !(price > 0)) return price

  const step = category.rounding_step > 0 ? category.rounding_step : 1
  const units = price / step
  const rounded = category.rounding === 'up'
    ? Math.ceil(units)
    : category.rounding === 'down'
      ? Math.floor(units)
      : Math.round(units)

  // Ціна не має впасти в нуль через великий крок: товар за 0 грн маркетплейс
  // або відкине, або продасть
  const value = Math.round(rounded * step * 100) / 100
  return value > 0 ? value : Math.round(step * 100) / 100
}

/**
 * Базова ціна товару для цього фіда — до формули фасування.
 *
 * Категорія, яка посилається на ціну з Бітрікса, але її для товару немає,
 * відкочується до каталожної: краще віддати звичну ціну, ніж не віддати
 * товар узагалі. Коефіцієнт при цьому діє — він про майданчик, а не про те,
 * звідки взялось число.
 */
export function basePrice(
  product: { id: string; price: number | string | null },
  line: { custom_price?: number | string | null; price_category_id?: string | null },
  ctx: PricingContext,
): { price: number; fromCategory: boolean } {
  const catalogue = Number(product.price ?? 0)

  // Вписана руками ціна не множиться ні на що: її вписали саме такою
  if (line.custom_price != null && line.custom_price !== '') {
    return { price: Number(line.custom_price), fromCategory: false }
  }

  const category = (line.price_category_id ? ctx.byId.get(line.price_category_id) : null)
    ?? ctx.feedCategory
  if (!category) return { price: catalogue, fromCategory: false }

  const source = category.source === 'bitrix' && category.bitrix_price_type_id != null
    ? ctx.bitrixPrices.get(product.id)?.get(category.bitrix_price_type_id) ?? catalogue
    : catalogue

  const price = Math.round(source * category.multiplier * 100) / 100
  return { price, fromCategory: true }
}

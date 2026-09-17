// Shared between the marketplace feed generators. Pure — no I/O, no marketplace
// specifics beyond the pricing rule the shop uses everywhere.

/**
 * Marketplace price for weight products:
 * кг/л: price is per kg → multiply by min_kg (default 0.4 = 400g if no min)
 * г/мл: price is already per-portion → no change
 * piece: return null (no transformation)
 */
export function calcMarketplacePrice(price: number, attrs: Record<string, string> | null): number | null {
  const unit = (attrs?.['Одиниця'] ?? '').toLowerCase()
  const minRaw = parseFloat(attrs?.['Мін'] ?? '0') || 0
  if (unit === 'кг' || unit === 'л') {
    const minKg = minRaw > 0 ? minRaw : 0.4
    return Math.round(price * minKg * 100) / 100
  }
  if (unit === 'г' || unit === 'мл') {
    return Math.round(price * 100) / 100
  }
  return null
}

/** Min weight label for product name (weight products only, in grams) */
export function minWeightLabel(attrs: Record<string, string> | null): string | null {
  const unit = (attrs?.['Одиниця'] ?? '').toLowerCase()
  const minRaw = parseFloat(attrs?.['Мін'] ?? '0') || 0
  if (unit === 'кг' || unit === 'л') return `${minRaw > 0 ? Math.round(minRaw * 1000) : 400} г`
  if (unit === 'г' || unit === 'мл') return `${minRaw > 0 ? Math.round(minRaw) : 400} ${unit}`
  return null
}

export function escapeXml(str: string): string {
  if (!str) return ''
  return stripControlChars(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// Strip XML-forbidden control characters (ASCII 0-8, 11-12, 14-31)
export function stripControlChars(str: string): string {
  return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
}

/**
 * Whether an offer is for sale, and how many of it.
 *
 * A product that leaves the site must not leave the feed with it. A
 * marketplace reads a missing offer as "this no longer exists" and retires the
 * card — its reviews, its ranking and its position in search go with it, and
 * bringing the product back means starting that card from nothing. An offer
 * that stays and says "out of stock" keeps all of it and comes back the day
 * the product does.
 *
 * So a retired product is always sent, always unavailable, always zero. Never
 * dropped, and never — as MauDau was being told until now — advertised as in
 * stock because the offer was built without looking at its status.
 */
export interface OfferStock {
  available: boolean
  /** null means "do not send a number" — see zeroStockMeansUnlimited */
  quantity: number | null
}

export function offerStock(
  productStatus: string | null | undefined,
  stock: number | null | undefined,
  opts: { zeroStockMeansUnlimited?: boolean } = {},
): OfferStock {
  // A withdrawal is not read here. An approved removal switches the product
  // off in the feeds it names, so those stop carrying the offer at all — and
  // a removal aimed at one marketplace must leave the others selling.

  // Gone from the site: kept in the feed, plainly out of stock
  if (productStatus !== 'active') return { available: false, quantity: 0 }

  const n = Number(stock)
  if (Number.isFinite(n) && n > 0) return { available: true, quantity: Math.ceil(n) }

  // Stock zero is ambiguous: WooCommerce reports it both for "none left" and
  // for products whose stock it does not track at all. Each marketplace reads
  // it the way its own feed was set up to.
  return opts.zeroStockMeansUnlimited
    ? { available: true, quantity: null }
    : { available: false, quantity: 0 }
}

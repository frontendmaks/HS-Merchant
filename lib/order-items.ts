/**
 * Turning a marketplace order line into something an operator can correct.
 *
 * A weighted product is listed as a fixed pack — "Ковбаса «Ласун» в/г, 650 г" —
 * and the marketplace charges per pack. What the customer actually wants is
 * weight: 0.65 kg × 2 packs = 1.3 kg. Meat never comes out exact, so the
 * operator types the invoice weight and the line is re-priced from our own
 * price list, per kilogram.
 */

/** Cyrillic letters that look identical to Latin ones. Our SKUs are typed with
 *  Cyrillic К, the marketplace echoes Latin K — without folding, nothing joins. */
const LOOKALIKES: Record<string, string> = {
  'А': 'A', 'В': 'B', 'Е': 'E', 'І': 'I', 'К': 'K', 'М': 'M',
  'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'Х': 'X',
}

export const foldSku = (s: string | null | undefined): string =>
  (s ?? '').trim().toUpperCase().replace(/[АВЕІКМНОРСТХ]/g, c => LOOKALIKES[c] ?? c)

/** Weight baked into a product title: "…, 650 г" -> 0.65 kg. */
export function weightFromTitle(title: string): number | null {
  const m = title.match(/(\d+(?:[.,]\d+)?)\s*(кг|г|мл|л)(?![а-яА-ЯіїєґІЇЄҐa-zA-Z])/i)
  if (!m) return null
  const n = parseFloat(m[1].replace(',', '.'))
  if (!Number.isFinite(n) || n <= 0) return null
  const unit = m[2].toLowerCase()
  return unit === 'кг' || unit === 'л' ? n : n / 1000
}

export interface CatalogProduct {
  id: string
  name: string
  sku: string | null
  external_id: string | null
  price: number | null
  attributes: Record<string, string> | null
}

/** Index the catalogue once, then resolve lines against it. */
export function indexCatalog(products: CatalogProduct[]) {
  const byExternalId = new Map<string, CatalogProduct>()
  const bySku = new Map<string, CatalogProduct>()
  for (const p of products) {
    if (p.external_id) byExternalId.set(p.external_id.trim(), p)
    if (p.sku) bySku.set(foldSku(p.sku), p)
  }
  return {
    find(externalId: string | null | undefined): CatalogProduct | null {
      const key = (externalId ?? '').trim()
      if (!key) return null
      // The marketplace sends the WooCommerce id for most lines and a SKU for
      // the rest, so try both.
      return byExternalId.get(key) ?? bySku.get(foldSku(key)) ?? null
    },
  }
}

export type Unit = 'кг' | 'шт'

/** Weighted when our catalogue says кг/л. Falls back to the title when the
 *  product is no longer in the catalogue. */
export function unitOf(product: CatalogProduct | null, title: string): Unit {
  const attr = product?.attributes?.['Одиниця']?.toLowerCase()
  if (attr === 'кг' || attr === 'л') return 'кг'
  if (attr) return 'шт'
  return weightFromTitle(title) != null ? 'кг' : 'шт'
}

/** Kilograms in one listed pack. 1 for piece goods. */
export function unitWeightOf(product: CatalogProduct | null, title: string, unit: Unit): number {
  if (unit !== 'кг') return 1
  const min = parseFloat(product?.attributes?.['Мін'] ?? '')
  if (Number.isFinite(min) && min > 0) return min
  return weightFromTitle(title) ?? 0.4   // 400 g is the marketplace default pack
}

export interface MarketplaceLine {
  itemId: string | null
  externalId: string | null
  title: string
  /** Price of one listed pack, in UAH */
  unitPrice: number
  /** Number of packs ordered */
  quantity: number
}

export interface OrderLine {
  position: number
  source: 'marketplace' | 'manual'
  marketplace_item_id: string | null
  product_external_id: string | null
  product_id: string | null
  title: string
  unit: Unit
  unit_weight: number
  marketplace_unit_price: number | null
  marketplace_qty: number | null
  /** What the marketplace charged for this line */
  ordered_total: number
  /** Our price list, per kg or per piece */
  price_per_unit: number
  /** Ordered amount expressed in `unit`: kg for weighted, pieces otherwise */
  ordered_qty: number
  actual_qty: number | null
  removed: boolean
}

/** Builds an editable line from what the marketplace sent. */
export function buildLine(
  line: MarketplaceLine,
  catalog: ReturnType<typeof indexCatalog>,
  position: number,
): OrderLine {
  const product = catalog.find(line.externalId)
  const unit = unitOf(product, line.title)
  const unitWeight = unitWeightOf(product, line.title, unit)

  // Our own price list decides the corrected sum. For weighted goods it is
  // already per kilogram; for piece goods it is per piece.
  const listPrice = Number(product?.price ?? 0)
  const price_per_unit = listPrice > 0
    ? listPrice
    // Not in the catalogue any more — fall back to what the marketplace charged
    : (unit === 'кг' ? line.unitPrice / (unitWeight || 1) : line.unitPrice)

  return {
    position,
    source: 'marketplace',
    marketplace_item_id: line.itemId,
    product_external_id: line.externalId,
    product_id: product?.id ?? null,
    title: line.title,
    unit,
    unit_weight: unitWeight,
    marketplace_unit_price: line.unitPrice,
    marketplace_qty: line.quantity,
    ordered_total: round2(line.unitPrice * line.quantity),
    price_per_unit: round2(price_per_unit),
    ordered_qty: unit === 'кг'
      ? round3(unitWeight * line.quantity)
      : line.quantity,
    actual_qty: null,
    removed: false,
  }
}

export const round2 = (n: number) => Math.round(n * 100) / 100
export const round3 = (n: number) => Math.round(n * 1000) / 1000

/** Effective amount: the invoice figure once entered, the ordered one until then. */
export const effectiveQty = (l: Pick<OrderLine, 'ordered_qty' | 'actual_qty'>): number =>
  l.actual_qty != null ? l.actual_qty : l.ordered_qty

/** What the line costs after correction. */
export const correctedTotal = (
  l: Pick<OrderLine, 'ordered_qty' | 'actual_qty' | 'price_per_unit' | 'removed'>
): number => (l.removed ? 0 : round2(effectiveQty(l) * l.price_per_unit))

export interface OrderTotals {
  ordered: number
  corrected: number
  diff: number
}

export function orderTotals(lines: OrderLine[]): OrderTotals {
  const ordered = round2(
    lines.filter(l => l.source === 'marketplace')
      .reduce((s, l) => s + l.ordered_total, 0)
  )
  const corrected = round2(lines.reduce((s, l) => s + correctedTotal(l), 0))
  return { ordered, corrected, diff: round2(corrected - ordered) }
}

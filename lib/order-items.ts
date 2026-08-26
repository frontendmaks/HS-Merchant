/**
 * Turning a marketplace order line into something an operator can correct.
 *
 * A weighted product is listed as a fixed pack — "Ковбаса «Ласун» в/г, 650 г" —
 * and the marketplace charges per pack, whether the goods are sold by weight or
 * by the piece. So a correction is a change in the number of packs, never a
 * weight: MauDau accepts whole packs and silently discards anything else, which
 * is checked, not assumed — 10.4, 2.5 and "2.5" were all ignored on a live
 * order while the integer 3 went through on the same one.
 *
 * Weight and money follow from the pack count: 2 packs of 650 g is 1.3 kg, and
 * two pack prices.
 *
 * The rate is the marketplace's own, not our price list: the customer agreed to
 * the price they saw, and it is that figure the corrected total, the commission
 * and the waybill's declared value all have to agree with. Where the two
 * differ, using ours would quietly bill a different amount than was shown.
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
  /** Present on rows read back from the database, absent on freshly built ones */
  id?: string
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
  /** The marketplace's own rate, per kg or per piece */
  price_per_unit: number
  /** Ordered amount expressed in `unit`: kg for weighted, pieces otherwise */
  ordered_qty: number
  actual_qty: number | null
  removed: boolean
}

/**
 * The marketplace's rate in the unit the line is corrected in.
 *
 * Falls back to our price list only when the marketplace sent no price at all —
 * without it a missing price would silently zero the line, which reads as a
 * free product rather than as missing data.
 */
export function marketplaceRate(
  unitPrice: number | null | undefined,
  unit: Unit,
  unitWeight: number,
  listPrice?: number | null,
): number {
  const price = Number(unitPrice ?? 0)
  if (price > 0) {
    return round2(unit === 'кг' ? price / (unitWeight || 1) : price)
  }
  return round2(Number(listPrice ?? 0))
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

  // The marketplace price decides the corrected sum. It is quoted per pack, so
  // a weighted line is divided by the pack weight to get a rate per kilogram;
  // a piece line is already the rate.
  const price_per_unit = marketplaceRate(line.unitPrice, unit, unitWeight, product?.price)

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
    price_per_unit,
    ordered_qty: unit === 'кг'
      ? round3(unitWeight * line.quantity)
      : line.quantity,
    actual_qty: null,
    removed: false,
  }
}

export const round2 = (n: number) => Math.round(n * 100) / 100
export const round3 = (n: number) => Math.round(n * 1000) / 1000

/** Packs the marketplace charged for. */
export const orderedPacks = (l: Pick<OrderLine, 'marketplace_qty' | 'ordered_qty' | 'unit' | 'unit_weight'>): number =>
  l.marketplace_qty != null
    ? l.marketplace_qty
    // A line added by hand was never on the marketplace, so its own amount is
    // the pack count
    : (l.unit === 'кг' && l.unit_weight > 0 ? Math.round(l.ordered_qty / l.unit_weight) : l.ordered_qty)

/** Packs after correction: what the operator counted, or the ordered figure. */
export const effectivePacks = (
  l: Pick<OrderLine, 'marketplace_qty' | 'ordered_qty' | 'actual_qty' | 'unit' | 'unit_weight'>,
): number => (l.actual_qty != null ? l.actual_qty : orderedPacks(l))

/** The amount in the line's own unit — kilograms for weighted goods, pieces
 *  otherwise. Derived from packs rather than stored, so the two cannot drift. */
export const effectiveQty = (
  l: Pick<OrderLine, 'marketplace_qty' | 'ordered_qty' | 'actual_qty' | 'unit' | 'unit_weight'>,
): number => {
  const packs = effectivePacks(l)
  return l.unit === 'кг' ? round3(packs * (l.unit_weight || 1)) : packs
}

/** What the line costs after correction — pack count times the pack price. */
export const correctedTotal = (
  l: Pick<OrderLine, 'marketplace_qty' | 'ordered_qty' | 'actual_qty' | 'unit'
    | 'unit_weight' | 'price_per_unit' | 'removed'>,
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


// --- Shipment weight --------------------------------------------------------

/** Assumed weight of a piece good whose title says nothing, in kg. */
const UNKNOWN_PIECE_KG = 0.4

export interface WeightBreakdown {
  /** Total kilograms, rounded to 3 decimals */
  kg: number
  /** Lines whose weight had to be assumed rather than read */
  assumed: string[]
}

/**
 * Physical weight of what actually goes in the box, after corrections.
 *
 * Weighed lines already carry kilograms. Piece lines carry a count, so the
 * per-pack weight comes from the title — "Свинина тушкована, 500 г" × 11.
 */
export function shipmentWeight(lines: OrderLine[]): WeightBreakdown {
  let kg = 0
  const assumed: string[] = []

  for (const l of lines) {
    if (l.removed) continue
    const qty = effectiveQty(l)

    if (l.unit === 'кг') {
      kg += qty
      continue
    }

    // unit_weight is 1 for pieces, so fall back to what the title declares
    const perPiece = l.unit_weight > 1 ? l.unit_weight : weightFromTitle(l.title)
    if (perPiece == null) {
      assumed.push(l.title)
      kg += qty * UNKNOWN_PIECE_KG
    } else {
      kg += qty * perPiece
    }
  }

  return { kg: round3(kg), assumed }
}

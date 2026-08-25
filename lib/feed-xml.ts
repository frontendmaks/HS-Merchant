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

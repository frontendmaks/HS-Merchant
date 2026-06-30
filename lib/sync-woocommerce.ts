import { createServiceClient } from '@/lib/supabase/service'

const WC_URL = process.env.WC_URL!
const CK = process.env.WC_CONSUMER_KEY!
const CS = process.env.WC_CONSUMER_SECRET!
const WAREHOUSE = process.env.WC_WAREHOUSE ?? 'Гуртівня онлайн'

function wcFetch(path: string) {
  const sep = path.includes('?') ? '&' : '?'
  return fetch(`${WC_URL}/wp-json/wc/v3${path}${sep}consumer_key=${CK}&consumer_secret=${CS}`, {
    cache: 'no-store',
  })
}

async function fetchWCPage(page: number) {
  const res = await wcFetch(`/products?per_page=100&page=${page}&status=publish&_fields=id,name,slug,type,sku,status,price,regular_price,sale_price,manage_stock,stock_quantity,categories,images,attributes,description,short_description,meta_data`)
  const total = Number(res.headers.get('x-wp-total') ?? 0)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any[] = await res.json()
  return { data, total }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchWarehouseVariation(productId: number): Promise<{ price: number | null; price_old: number | null; stock: number | null } | null> {
  const res = await wcFetch(`/products/${productId}/variations?per_page=100`)
  if (!res.ok) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const variations: any[] = await res.json()

  const match = variations.find(v =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    v.attributes?.some((a: any) =>
      (a.name?.includes('Storage') || a.name?.includes('Склад')) &&
      a.option === WAREHOUSE
    )
  )
  if (!match) return null

  const salePrice = match.sale_price ? parseFloat(match.sale_price) : null
  const regularPrice = parseFloat(match.regular_price || match.price || '0') || null

  return {
    price: salePrice ?? regularPrice,
    price_old: salePrice && regularPrice && salePrice < regularPrice ? regularPrice : null,
    stock: match.manage_stock ? (match.stock_quantity ?? 0) : null,
  }
}

function extractWeight(name: string): string | null {
  // Match weight/volume at end of name (common pattern: "Product Name, 250 г" or "Product 0.5 л")
  // Look for number + unit, with comma/space before — covers г, мл, л, кг
  // Must not be preceded by slash or letter (e.g. avoid "82,5%" → "5 г" false match)
  const match = name.match(/(?:,\s*|(?<![/а-яА-ЯіІїЇєЄa-zA-Z%,]))(\d+(?:[.,]\d+)?)\s*(кг|мл|л(?![а-яА-ЯіІїЇєЄ])|г)(?![а-яА-ЯіІїЇєЄa-zA-Z/\d])/)
  if (!match) return null
  // Normalize: replace comma decimal separator with dot
  const num = match[1].replace(',', '.')
  return `${num} ${match[2]}`
}

function extractBrand(name: string): string {
  // Match ТМ "Brand" / ТМ «Brand» / ТМ 'Brand' — with or without space between ТМ and quote
  // Also match TM (latin letters) and various quote styles
  const match = name.match(/[ТTтt][МMмm]\s*["'«„"“„«]([^"'»"”»,]{1,60})/)
  if (match) return match[1].trim()
  return 'Галицька Свіжина'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapProduct(p: any, variation?: { price: number | null; stock: number | null } | null, categoryMap: Map<number, string> = new Map()) {
  const images = (p.images ?? []).map((img: { src: string }) => img.src).filter(Boolean)

  const attributes: Record<string, string> = {}
  for (const attr of p.attributes ?? []) {
    const name: string = attr.name ?? ''
    const slug: string = attr.slug ?? ''
    // Skip warehouse/storage attribute (multilingual name or pa_storage slug)
    if (slug === 'pa_storage' || /\[:en\]Storage/i.test(name)) continue
    if (attr.options?.length) attributes[name] = attr.options.join(', ')
  }
  const weight = extractWeight(p.name)
  if (weight) attributes['Вага'] = weight

  // Extract step, min_value, unit_base from WC meta_data
  const meta = p.meta_data ?? []
  const getMetaVal = (key: string) => meta.find((m: any) => m.key === key)?.value ?? null

  const stepVal = parseFloat(getMetaVal('step') ?? getMetaVal('_alg_wc_pq_step') ?? getMetaVal('wc_min_quantity_step') ?? '0') || null
  const minVal  = parseFloat(getMetaVal('min_value') ?? getMetaVal('minimum_quantity') ?? '0') || null
  // unit_base may be multilingual: "[:uk]кг[:en]kg[:]" — extract Ukrainian part
  const rawUnit = (getMetaVal('unit_base') as string | null) ?? 'шт'
  const unitMatch = rawUnit.match(/\[:uk\]([^\[]+)/)
  const unitBase = unitMatch ? unitMatch[1].trim() : rawUnit.trim()

  if (stepVal && stepVal > 0) attributes['Крок'] = String(stepVal)
  if (minVal && minVal > 0)   attributes['Мін']  = String(minVal)
  if (unitBase)               attributes['Одиниця'] = unitBase

  const category_name = pickMainCategory(p, categoryMap)
  const categories = (p.categories ?? [])
    .map((c: { id: number; name: string }) => categoryMap.get(c.id) ?? c.name)
    .filter(Boolean) as string[]
  const brand = extractBrand(p.name)

  // For simple products: use sale_price if set, otherwise regular_price
  // For variable products: price comes from variation (already resolved with sale)
  let price: number
  let price_old: number | null
  if (variation !== undefined && variation !== null) {
    // Variable product with warehouse variation
    price = variation.price ?? 0
    price_old = (variation as any).price_old ?? null
  } else {
    const salePrice = p.sale_price ? parseFloat(p.sale_price) : null
    const regularPrice = parseFloat(p.regular_price || p.price || '0') || 0
    price = salePrice ?? regularPrice
    price_old = salePrice && regularPrice && salePrice < regularPrice ? regularPrice : null
  }

  let stock: number | null
  if (variation === undefined) {
    stock = p.manage_stock ? (p.stock_quantity ?? 0) : null
  } else if (variation === null) {
    stock = 0
  } else {
    stock = variation.stock
  }

  return {
    external_id: String(p.id),
    name: p.name,
    slug: p.slug,
    description: p.description?.replace(/<[^>]*>/g, '').trim() || p.short_description?.replace(/<[^>]*>/g, '').trim() || null,
    sku: p.sku || null,
    price,
    price_old,
    currency: 'UAH' as const,
    stock,
    status: 'active' as const,
    images,
    attributes,
    categories,
    vendor: brand,
    brand,
    category_name,
  }
}

/** Build a map of category id → name from all WC product categories */
async function fetchCategoryMap(): Promise<Map<number, string>> {
  const map = new Map<number, string>()
  let page = 1
  while (true) {
    const res = await wcFetch(`/products/categories?per_page=100&page=${page}`)
    if (!res.ok) break
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cats: any[] = await res.json()
    if (!cats.length) break
    for (const c of cats) map.set(c.id, c.name)
    if (cats.length < 100) break
    page++
  }
  return map
}

/** Pick the primary (Yoast "Основний") category for a product.
 *  Falls back to the first assigned category if no primary is set. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pickMainCategory(p: any, categoryMap: Map<number, string>): string | null {
  // Yoast SEO stores the primary category ID in meta_data
  const primaryMeta = (p.meta_data ?? []).find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (m: any) => m.key === '_yoast_wpseo_primary_product_cat'
  )
  if (primaryMeta?.value) {
    const primaryId = Number(primaryMeta.value)
    const name = categoryMap.get(primaryId)
    if (name) return name
  }

  // Fallback: first assigned category
  const first = p.categories?.[0]
  return first ? (categoryMap.get(first.id) ?? first.name ?? null) : null
}

export async function syncWoocommerce(trigger: 'cron' | 'manual' = 'manual', triggeredBy: string | null = null): Promise<{
  synced: number
  deactivated: number
  total: number
  with_warehouse_stock: number
  without_variation: number
}> {
  const startedAt = Date.now()
  const supabase = createServiceClient()

  try {
    // Fetch category id→name map (used to resolve Yoast primary category)
    const categoryMap = await fetchCategoryMap()

    const { data: firstPage, total } = await fetchWCPage(1)
    const totalPages = Math.ceil(total / 100)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let allProducts: any[] = [...firstPage]
    for (let batch = 2; batch <= totalPages; batch += 5) {
      const pages = Array.from({ length: Math.min(5, totalPages - batch + 1) }, (_, i) => batch + i)
      const results = await Promise.all(pages.map(p => fetchWCPage(p)))
      allProducts.push(...results.flatMap(r => r.data))
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const variableProducts = allProducts.filter((p: any) => p.type === 'variable')
    const variationMap = new Map<number, { price: number | null; stock: number | null } | null>()

    for (let i = 0; i < variableProducts.length; i += 10) {
      const batch = variableProducts.slice(i, i + 10)
      const results = await Promise.all(batch.map((p: { id: number }) => fetchWarehouseVariation(p.id)))
      batch.forEach((p: { id: number }, idx: number) => variationMap.set(p.id, results[idx]))
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapped = allProducts.map((p: any) => {
      const variation = variationMap.has(p.id) ? variationMap.get(p.id) : undefined
      return mapProduct(p, variation, categoryMap)
    })

    const { error } = await supabase
      .from('products')
      .upsert(mapped, { onConflict: 'external_id', ignoreDuplicates: false })

    if (error) throw error

    const activeExternalIds = mapped.map(p => p.external_id)
    const { data: deactivated } = await supabase
      .from('products')
      .update({ status: 'inactive' })
      .eq('status', 'active')
      .not('external_id', 'in', `(${activeExternalIds.join(',')})`)
      .select('id')

    const withVariation = [...variationMap.values()].filter(Boolean).length
    const deactivatedCount = deactivated?.length ?? 0

    await supabase.from('sync_logs').insert({
      synced: mapped.length,
      deactivated: deactivatedCount,
      total_wc: total,
      with_warehouse_stock: withVariation,
      without_variation: variableProducts.length - withVariation,
      duration_ms: Date.now() - startedAt,
      status: 'success',
      trigger,
      triggered_by: triggeredBy,
    })

    return {
      synced: mapped.length,
      deactivated: deactivatedCount,
      total,
      with_warehouse_stock: withVariation,
      without_variation: variableProducts.length - withVariation,
    }
  } catch (err) {
    try {
      await supabase.from('sync_logs').insert({
        synced: 0, deactivated: 0, total_wc: 0,
        with_warehouse_stock: 0, without_variation: 0,
        duration_ms: Date.now() - startedAt,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        trigger,
        triggered_by: triggeredBy,
      })
    } catch {}
    throw err
  }
}

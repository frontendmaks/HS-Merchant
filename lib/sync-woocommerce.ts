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
  const res = await wcFetch(`/products?per_page=100&page=${page}&status=publish`)
  const total = Number(res.headers.get('x-wp-total') ?? 0)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any[] = await res.json()
  return { data, total }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchWarehouseVariation(productId: number): Promise<{ price: number | null; stock: number | null } | null> {
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

  return {
    price: parseFloat(match.price || match.regular_price || '0') || null,
    stock: match.manage_stock ? (match.stock_quantity ?? 0) : null,
  }
}

function extractWeight(name: string): string | null {
  const match = name.match(/(?<![/а-яА-ЯіІїЇєЄa-zA-Z])(\d+(?:[.,]\d+)?)\s*(кг|мл|л(?!а)|г)(?![а-яА-ЯіІїЇєЄa-zA-Z/\d])/)
  if (!match) return null
  return `${match[1]} ${match[2]}`
}

function extractBrand(name: string): string {
  const match = name.match(/[ТT][МM]\s+["'"«„"]([^"'"»",]+)/)
  return match ? match[1].trim() : 'Галицька Свіжина'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapProduct(p: any, variation?: { price: number | null; stock: number | null } | null, parentCategoryIds: Set<number> = new Set()) {
  const images = (p.images ?? []).map((img: { src: string }) => img.src).filter(Boolean)

  const attributes: Record<string, string> = {}
  for (const attr of p.attributes ?? []) {
    const name: string = attr.name ?? ''
    if (name.includes('Storage') || name.includes('Склад')) continue
    if (attr.options?.length) attributes[name] = attr.options.join(', ')
  }
  const weight = extractWeight(p.name)
  if (weight) attributes['Вага'] = weight

  const category_name = pickMainCategory(p.categories ?? [], parentCategoryIds)
  const brand = extractBrand(p.name)
  const price = (variation?.price) ?? (parseFloat(p.regular_price || p.price || '0') || 0)

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
    price_old: p.sale_price ? parseFloat(p.regular_price || '0') : null,
    currency: 'UAH' as const,
    stock,
    status: 'active' as const,
    images,
    attributes,
    vendor: brand,
    brand,
    category_name,
  }
}

/** Fetch all WC product categories and return a Set of IDs that are parents of other categories */
async function fetchParentCategoryIds(): Promise<Set<number>> {
  const parentIds = new Set<number>()
  let page = 1
  while (true) {
    const res = await wcFetch(`/products/categories?per_page=100&page=${page}`)
    if (!res.ok) break
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cats: any[] = await res.json()
    if (!cats.length) break
    for (const c of cats) {
      if (c.parent && c.parent !== 0) {
        parentIds.add(c.parent)
      }
    }
    if (cats.length < 100) break
    page++
  }
  return parentIds
}

/** Pick the most specific (leaf) category for a product.
 *  Prefers child categories over parent categories.
 *  Falls back to first category if all are parents or list is empty. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pickMainCategory(categories: any[], parentIds: Set<number>): string | null {
  if (!categories?.length) return null
  // prefer categories that are NOT a parent of another category (i.e. leaf nodes)
  const leaves = categories.filter(c => !parentIds.has(c.id))
  const chosen = leaves.length > 0 ? leaves[0] : categories[0]
  return chosen?.name ?? null
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
    // Fetch category hierarchy to know which categories are parents
    const parentCategoryIds = await fetchParentCategoryIds()

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
      return mapProduct(p, variation, parentCategoryIds)
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

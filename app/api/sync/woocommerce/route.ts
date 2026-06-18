import { createServiceClient } from '@/lib/supabase/service'
import { NextResponse } from 'next/server'

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
  const data = await res.json()
  return { data, total }
}

// Отримуємо варіацію конкретного складу для змінного товару
async function fetchWarehouseVariation(productId: number): Promise<{ price: number | null; stock: number | null } | null> {
  const res = await wcFetch(`/products/${productId}/variations?per_page=100`)
  if (!res.ok) return null
  const variations: any[] = await res.json()

  const match = variations.find(v =>
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

function extractBrand(name: string): string {
  // Підтримуємо кирилицю ТМ і латиницю TM, різні типи лапок
  const match = name.match(/[ТT][МM]\s+["'"«„"]([^"'"»",]+)/)
  return match ? match[1].trim() : 'Галицька Свіжина'
}

function mapProduct(p: any, variation?: { price: number | null; stock: number | null } | null) {
  const images = (p.images ?? []).map((img: any) => img.src).filter(Boolean)

  // Прибираємо атрибут складів (не потрібен в XML)
  const attributes: Record<string, string> = {}
  for (const attr of p.attributes ?? []) {
    const name: string = attr.name ?? ''
    if (name.includes('Storage') || name.includes('Склад')) continue
    if (attr.options?.length) attributes[name] = attr.options.join(', ')
  }
  if (p.weight) attributes['Вага'] = `${p.weight} кг`

  // Перша категорія = головна
  const category_name = p.categories?.[0]?.name ?? null

  // Бренд з назви або дефолт
  const brand = extractBrand(p.name)

  const price = (variation?.price) ?? (parseFloat(p.regular_price || p.price || '0') || 0)

  let stock: number | null
  if (variation === undefined) {
    // Не змінний товар — беремо з рівня продукту
    stock = p.manage_stock ? (p.stock_quantity ?? 0) : null
  } else if (variation === null) {
    // Змінний товар, але варіацію складу не знайдено → 0
    stock = 0
  } else {
    // Знайшли варіацію складу
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

export async function POST() {
  try {
    const supabase = createServiceClient()

    // 1. Тягнемо всі продукти
    const { data: firstPage, total } = await fetchWCPage(1)
    const totalPages = Math.ceil(total / 100)

    let allProducts: any[] = [...firstPage]
    for (let batch = 2; batch <= totalPages; batch += 5) {
      const pages = Array.from({ length: Math.min(5, totalPages - batch + 1) }, (_, i) => batch + i)
      const results = await Promise.all(pages.map(p => fetchWCPage(p)))
      allProducts.push(...results.flatMap(r => r.data))
    }

    // 2. Для variable продуктів — тягнемо варіацію "Гуртівня онлайн" батчами по 10
    const variableProducts = allProducts.filter(p => p.type === 'variable')
    const variationMap = new Map<number, { price: number | null; stock: number | null } | null>()

    for (let i = 0; i < variableProducts.length; i += 10) {
      const batch = variableProducts.slice(i, i + 10)
      const results = await Promise.all(batch.map(p => fetchWarehouseVariation(p.id)))
      batch.forEach((p, idx) => variationMap.set(p.id, results[idx]))
    }

    // 3. Маппінг
    const mapped = allProducts.map(p => {
      const variation = variationMap.has(p.id) ? variationMap.get(p.id) : undefined
      return mapProduct(p, variation)
    })

    // 4. Upsert в Supabase
    const { error } = await supabase
      .from('products')
      .upsert(mapped, { onConflict: 'external_id', ignoreDuplicates: false })

    if (error) throw error

    const withVariation = [...variationMap.values()].filter(Boolean).length
    return NextResponse.json({
      success: true,
      synced: mapped.length,
      total,
      warehouse: WAREHOUSE,
      with_warehouse_stock: withVariation,
      without_variation: variableProducts.length - withVariation,
    })
  } catch (err: any) {
    console.error('WC sync error:', err)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}

export async function GET() {
  const supabase = createServiceClient()
  const { count } = await supabase.from('products').select('*', { count: 'exact', head: true })
  return NextResponse.json({ products_in_db: count, warehouse: WAREHOUSE })
}

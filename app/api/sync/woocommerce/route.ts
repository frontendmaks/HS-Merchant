import { createServiceClient } from '@/lib/supabase/service'
import { NextResponse } from 'next/server'

const WC_URL = process.env.WC_URL!
const CK = process.env.WC_CONSUMER_KEY!
const CS = process.env.WC_CONSUMER_SECRET!

async function fetchWCPage(page: number) {
  const url = `${WC_URL}/wp-json/wc/v3/products?consumer_key=${CK}&consumer_secret=${CS}&per_page=100&page=${page}&status=publish`
  const res = await fetch(url, { cache: 'no-store' })
  const total = Number(res.headers.get('x-wp-total') ?? 0)
  const data = await res.json()
  return { data, total }
}

function mapProduct(p: any) {
  const images = (p.images ?? []).map((img: any) => img.src).filter(Boolean)
  const attributes: Record<string, string> = {}
  for (const attr of p.attributes ?? []) {
    if (attr.name && attr.options?.length) {
      attributes[attr.name] = attr.options.join(', ')
    }
  }

  // Вага як атрибут
  if (p.weight) attributes['Вага'] = `${p.weight} кг`

  return {
    external_id: String(p.id),
    name: p.name,
    slug: p.slug,
    description: p.description?.replace(/<[^>]*>/g, '').trim() || p.short_description?.replace(/<[^>]*>/g, '').trim() || null,
    sku: p.sku || null,
    price: parseFloat(p.regular_price || p.price || '0') || 0,
    price_old: p.sale_price ? parseFloat(p.regular_price || '0') : null,
    currency: 'UAH' as const,
    // null = без управління залишками (необмежено), 0 = немає в наявності
    stock: p.manage_stock ? (p.stock_quantity ?? 0) : null,
    status: 'active' as const,
    images,
    attributes,
    vendor: 'Галицька Свіжина',
  }
}

export async function POST() {
  try {
    const supabase = createServiceClient()

    // Дізнаємось скільки сторінок
    const { data: firstPage, total } = await fetchWCPage(1)
    const totalPages = Math.ceil(total / 100)

    // Завантажуємо всі сторінки паралельно (батчами по 5)
    let allProducts = [...firstPage]
    for (let batch = 2; batch <= totalPages; batch += 5) {
      const pages = Array.from({ length: Math.min(5, totalPages - batch + 1) }, (_, i) => batch + i)
      const results = await Promise.all(pages.map(p => fetchWCPage(p)))
      allProducts.push(...results.flatMap(r => r.data))
    }

    // Маппінг і upsert в Supabase
    const mapped = allProducts.map(mapProduct)

    const { error, count } = await supabase
      .from('products')
      .upsert(mapped, {
        onConflict: 'external_id',
        ignoreDuplicates: false,
      })

    if (error) throw error

    return NextResponse.json({
      success: true,
      synced: mapped.length,
      total,
      pages: totalPages,
    })
  } catch (err: any) {
    console.error('WC sync error:', err)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}

// GET — статус (скільки зараз в БД)
export async function GET() {
  const supabase = createServiceClient()
  const { count } = await supabase.from('products').select('*', { count: 'exact', head: true })
  return NextResponse.json({ products_in_db: count })
}

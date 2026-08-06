import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentRole } from '@/lib/getRole'
import { Suspense } from 'react'
import ProductsToolbar from './ProductsToolbar'
import SortableHeader from './SortableHeader'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

const PER_PAGE = 50

const ALLOWED_SORT = ['name', 'price', 'stock', 'status', 'category_name', 'brand'] as const
type SortCol = typeof ALLOWED_SORT[number]

function calcPer100g(price: number, attrs: Record<string, string> | null): number | null {
  const unit = (attrs?.['Одиниця'] ?? '').toLowerCase()
  const min = parseFloat(attrs?.['Мін'] ?? '0') || 0
  if (unit === 'кг') return Math.round(price / 10 * 10) / 10
  if (unit === 'л') return Math.round(price / 10 * 10) / 10
  if ((unit === 'г' || unit === 'мл') && min > 0) return Math.round(price / min * 100 * 10) / 10
  return null
}

async function getProducts(
  q: string, page: number, sort: SortCol, dir: 'asc' | 'desc',
  sale: boolean, inStock: boolean, outOfStock: boolean, warehouse: boolean,
  statusFilter: string, saleCat: string
) {
  const supabase = createServiceClient()
  const from = (page - 1) * PER_PAGE
  const to = from + PER_PAGE - 1

  let query = supabase
    .from('products')
    .select('id, name, sku, price, price_old, stock, status, images, external_id, category_name, categories, brand, attributes', { count: 'exact' })
    .order(sort, { ascending: dir === 'asc', nullsFirst: false })
    .range(from, to)

  // Status filter
  if (statusFilter === 'inactive') {
    query = query.eq('status', 'inactive')
  } else if (statusFilter === 'out_of_stock') {
    query = query.eq('status', 'out_of_stock')
  } else {
    query = query.eq('status', 'active')
  }

  if (q) query = query.ilike('name', `%${q}%`)
  if (sale) query = query.not('price_old', 'is', null)
  if (inStock) query = query.gt('stock', 0)
  if (outOfStock) query = query.eq('stock', 0)
  if (warehouse) query = query.not('stock', 'is', null)

  const { data, count } = await query
  let products = data ?? []

  // Filter by sale category client-side (categories is an array field)
  if (saleCat) {
    products = products.filter(p => (p.categories as string[] | null)?.includes(saleCat))
  }

  return { products, total: count ?? 0 }
}

async function getSaleCategories() {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('products')
    .select('categories')
    .eq('status', 'active')
    .not('categories', 'is', null)
  if (!data) return []
  const all = new Set<string>()
  for (const row of data) {
    for (const cat of (row.categories as string[] | null) ?? []) {
      if (cat.toLowerCase().includes('акці')) all.add(cat)
    }
  }
  return [...all].sort()
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string; page?: string; sort?: string; dir?: string; sale?: string
    instock?: string; outstock?: string; warehouse?: string; status?: string; salecat?: string
  }>
}) {
  const { getCurrentRole } = await import('@/lib/getRole')
  const { redirect } = await import('next/navigation')
  const userRole = await getCurrentRole()
  if (userRole === 'operator') redirect('/orders')

  const {
    q = '', page: pageStr = '1', sort: sortRaw = 'name', dir: dirRaw = 'asc',
    sale, instock, outstock, warehouse, status: statusFilter = 'active', salecat = ''
  } = await searchParams
  const page = Math.max(1, parseInt(pageStr) || 1)
  const sort = (ALLOWED_SORT.includes(sortRaw as SortCol) ? sortRaw : 'name') as SortCol
  const dir = dirRaw === 'desc' ? 'desc' : 'asc'
  const onSale = sale === '1'
  const filterInStock = instock === '1'
  const filterOutStock = outstock === '1'
  const filterWarehouse = warehouse === '1'
  const warehouseName = process.env.WC_WAREHOUSE ?? 'Гуртівня онлайн'

  const [{ products, total }, saleCategories] = await Promise.all([
    getProducts(q, page, sort, dir, onSale, filterInStock, filterOutStock, filterWarehouse, statusFilter, salecat),
    getSaleCategories(),
  ])
  const totalPages = Math.ceil(total / PER_PAGE)
  const readOnly = userRole === 'viewer'

  const buildPageUrl = (p: number) => {
    const sp = new URLSearchParams({
      ...(q && { q }), sort, dir, page: String(p),
      ...(sale && { sale }), ...(instock && { instock }), ...(outstock && { outstock }),
      ...(warehouse && { warehouse }), ...(statusFilter !== 'active' && { status: statusFilter }),
      ...(salecat && { salecat }),
    })
    return `/products?${sp.toString()}`
  }

  return (
    <div className="w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Товари</h1>
        <p className="text-zinc-500 text-sm mt-1">Каталог синхронізований з WooCommerce</p>
      </div>

      <div className="mb-4">
        <Suspense>
          <ProductsToolbar
            total={total}
            readOnly={readOnly}
            warehouseName={warehouseName}
            saleCategories={saleCategories}
          />
        </Suspense>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        {/* Table header */}
        <div className="grid gap-3 px-4 py-3 border-b border-zinc-800 bg-zinc-800/50"
          style={{ gridTemplateColumns: '72px 1fr 160px 160px 100px 100px 90px 45px 90px 100px 90px' }}>
          <div className="text-xs text-zinc-500 uppercase tracking-wide">Фото</div>
          <Suspense><SortableHeader column="name" label="Назва / Артикул" /></Suspense>
          <Suspense><SortableHeader column="category_name" label="Категорія" /></Suspense>
          <Suspense><SortableHeader column="brand" label="Бренд" /></Suspense>
          <Suspense><SortableHeader column="price" label="Ціна/100г" className="justify-end" /></Suspense>
          <div className="text-xs text-zinc-500 uppercase tracking-wide text-right">Акц./100г</div>
          <Suspense><SortableHeader column="stock" label="Залишок" className="justify-end" /></Suspense>
          <div className="text-xs text-zinc-500 uppercase tracking-wide text-center">Од.</div>
          <div className="text-xs text-zinc-500 uppercase tracking-wide text-center">Мін. значення</div>
          <div className="text-xs text-zinc-500 uppercase tracking-wide text-center">Крок</div>
          <Suspense><SortableHeader column="status" label="Статус" className="justify-center" /></Suspense>
        </div>

        <div className="divide-y divide-zinc-800">
          {products.length === 0 && (
            <div className="py-16 text-center text-zinc-600">
              {q ? `Нічого не знайдено за запитом "${q}"` : 'Товарів немає'}
            </div>
          )}
          {products.map(p => {
            const img = (p.images as string[])?.[0]
            const noImg = !img
            const noPrice = !p.price || Number(p.price) <= 0
            const stockVal = p.stock as number | null
            const zeroStock = stockVal === 0 && p.status === 'active'
            const attrs = p.attributes as Record<string, string> | null
            const minVal = attrs?.['Мін'] ?? null
            const stepVal = attrs?.['Вага'] ?? attrs?.['Крок'] ?? null
            const unitBase = attrs?.['Одиниця'] ?? null

            const price100 = calcPer100g(Number(p.price), attrs)
            const salePr100 = p.price_old ? calcPer100g(Number(p.price), attrs) : null
            const origPr100 = p.price_old ? calcPer100g(Number(p.price_old), attrs) : null

            return (
              <div
                key={p.id}
                className="grid gap-3 px-4 py-2.5 items-center hover:bg-zinc-800/40 transition-colors"
                style={{ gridTemplateColumns: '72px 1fr 160px 160px 100px 100px 90px 45px 90px 100px 90px' }}
              >
                {/* Image */}
                <div className="w-14 h-14 rounded-lg overflow-hidden bg-zinc-800 shrink-0">
                  {img ? (
                    <img src={img} alt={p.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-zinc-600 text-xl">□</div>
                  )}
                </div>

                {/* Name + SKU */}
                <div className="min-w-0">
                  <div className="text-sm text-white leading-snug flex items-start gap-1.5">
                    <span className="line-clamp-2">{p.name}</span>
                    <div className="flex gap-1 shrink-0 mt-0.5">
                      {noImg && <span title="Немає фото" className="text-amber-500 text-xs">📷</span>}
                      {noPrice && <span title="Немає ціни" className="text-red-500 text-xs">₴</span>}
                    </div>
                  </div>
                  <div className="text-xs text-zinc-600 mt-0.5 font-mono flex items-center gap-2">
                    {p.sku
                      ? <span>{p.sku}</span>
                      : <span className="text-zinc-700">без артикулу</span>
                    }
                    {p.external_id && (
                      <a
                        href={`https://halytska-svizhyna.ua/?p=${p.external_id}`}
                        target="_blank"
                        className="text-zinc-600 hover:text-red-400"
                      >
                        #{p.external_id} ↗
                      </a>
                    )}
                  </div>
                </div>

                {/* Category */}
                <div className="text-xs text-zinc-400 truncate">
                  {p.category_name ?? <span className="text-zinc-700">—</span>}
                </div>

                {/* Brand */}
                <div className="text-xs truncate">
                  {p.brand === 'Галицька Свіжина'
                    ? <span className="text-red-400">{p.brand}</span>
                    : <span className="text-zinc-300">{p.brand}</span>
                  }
                </div>

                {/* Ціна / 100г */}
                <div className="text-right">
                  {noPrice ? (
                    <span className="text-red-500 text-sm">—</span>
                  ) : price100 != null ? (
                    <div>
                      <div className={`text-sm font-semibold ${p.price_old ? 'text-emerald-400' : 'text-white'}`}>
                        {price100} ₴
                      </div>
                      <div className="text-[10px] text-zinc-600">/100г</div>
                    </div>
                  ) : (
                    <div className={`text-sm font-semibold ${p.price_old ? 'text-emerald-400' : 'text-white'}`}>
                      {Number(p.price).toLocaleString('uk-UA')} ₴
                    </div>
                  )}
                </div>

                {/* Акційна / 100г */}
                <div className="text-right">
                  {p.price_old ? (
                    salePr100 != null ? (
                      <div>
                        <div className="text-xs text-emerald-400 font-medium">{salePr100} ₴</div>
                        <div className="text-[10px] text-zinc-500 line-through">{origPr100} ₴</div>
                      </div>
                    ) : (
                      <div>
                        <div className="text-xs text-zinc-500 line-through">
                          {Number(p.price_old).toLocaleString('uk-UA')} ₴
                        </div>
                        <div className="text-[10px] text-emerald-600 mt-0.5">
                          -{Math.round((1 - Number(p.price) / Number(p.price_old)) * 100)}%
                        </div>
                      </div>
                    )
                  ) : (
                    <span className="text-xs text-zinc-700">—</span>
                  )}
                </div>

                {/* Stock */}
                <div className={`text-sm text-right font-medium ${zeroStock ? 'text-red-400' : 'text-zinc-300'}`}>
                  {stockVal === null
                    ? <span className="text-zinc-500 text-xs">∞</span>
                    : <>
                        {Number(stockVal).toLocaleString('uk-UA', { maximumFractionDigits: 2 })}
                        {zeroStock && <span className="ml-1 text-xs text-red-400">⚠</span>}
                      </>
                  }
                </div>

                {/* Одиниця виміру */}
                <div className="text-xs text-zinc-500 text-center">
                  {unitBase ?? <span className="text-zinc-700">—</span>}
                </div>

                {/* Мінімальне значення */}
                <div className="text-xs text-center">
                  {minVal
                    ? <span className="text-zinc-400">{minVal}{unitBase && unitBase !== 'шт' ? <span className="text-zinc-600"> {unitBase}</span> : ''}</span>
                    : <span className="text-zinc-700">—</span>}
                </div>

                {/* Крок */}
                <div className="text-xs text-center">
                  {stepVal
                    ? <span className={stepVal === minVal ? 'text-blue-400' : 'text-amber-400'}>{stepVal}</span>
                    : <span className="text-zinc-700">—</span>}
                </div>

                {/* Status */}
                <div className="text-center">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    p.status === 'active'
                      ? 'bg-emerald-950 text-emerald-400'
                      : 'bg-zinc-800 text-zinc-500'
                  }`}>
                    {p.status === 'active' ? 'Актив' : p.status === 'inactive' ? 'Неактив' : p.status}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Pagination */}
      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <span>Сторінка {page} з {Math.max(1, totalPages)} · {total} товарів</span>
          <span className="text-zinc-700">{PER_PAGE} на сторінці</span>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            {page > 1 && (
              <Link href={buildPageUrl(page - 1)} className="px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg transition-colors">
                ← Попередня
              </Link>
            )}
            <span className="text-xs text-zinc-600 px-2">{page} / {totalPages}</span>
            {page < totalPages && (
              <Link href={buildPageUrl(page + 1)} className="px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg transition-colors">
                Наступна →
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

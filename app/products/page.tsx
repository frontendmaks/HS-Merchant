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

async function getProducts(q: string, page: number, sort: SortCol, dir: 'asc' | 'desc') {
  const supabase = createServiceClient()
  const from = (page - 1) * PER_PAGE
  const to = from + PER_PAGE - 1

  let query = supabase
    .from('products')
    .select('id, name, sku, price, price_old, stock, status, images, external_id, category_name, brand, attributes', { count: 'exact' })
    .eq('status', 'active')
    .order(sort, { ascending: dir === 'asc', nullsFirst: false })
    .range(from, to)

  if (q) query = query.ilike('name', `%${q}%`)

  const { data, count } = await query
  return { products: data ?? [], total: count ?? 0 }
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; sort?: string; dir?: string }>
}) {
  const { q = '', page: pageStr = '1', sort: sortRaw = 'name', dir: dirRaw = 'asc' } = await searchParams
  const page = Math.max(1, parseInt(pageStr) || 1)
  const sort = (ALLOWED_SORT.includes(sortRaw as SortCol) ? sortRaw : 'name') as SortCol
  const dir = dirRaw === 'desc' ? 'desc' : 'asc'

  const { products, total } = await getProducts(q, page, sort, dir)
  const totalPages = Math.ceil(total / PER_PAGE)
  const role = await getCurrentRole()
  const readOnly = role === 'viewer'

  const buildPageUrl = (p: number) => {
    const sp = new URLSearchParams({ ...(q && { q }), sort, dir, page: String(p) })
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
          <ProductsToolbar total={total} readOnly={readOnly} />
        </Suspense>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        {/* Table header */}
        <div className="grid gap-3 px-4 py-3 border-b border-zinc-800 bg-zinc-800/50"
          style={{ gridTemplateColumns: '72px 1fr 160px 160px 100px 90px 90px 90px' }}>
          <div className="text-xs text-zinc-500 uppercase tracking-wide">Фото</div>
          <Suspense><SortableHeader column="name" label="Назва / Артикул" /></Suspense>
          <Suspense><SortableHeader column="category_name" label="Категорія" /></Suspense>
          <Suspense><SortableHeader column="brand" label="Бренд" /></Suspense>
          <Suspense><SortableHeader column="price" label="Ціна" className="justify-end" /></Suspense>
          <Suspense><SortableHeader column="stock" label="Залишок" className="justify-end" /></Suspense>
          <div className="text-xs text-zinc-500 uppercase tracking-wide text-center">Вага</div>
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
            const weight = attrs?.['Вага'] ?? null

            return (
              <div
                key={p.id}
                className="grid gap-3 px-4 py-2.5 items-center hover:bg-zinc-800/40 transition-colors"
                style={{ gridTemplateColumns: '72px 1fr 160px 160px 100px 90px 90px 90px' }}
              >
                {/* Image — більша */}
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

                {/* Price */}
                <div className="text-right">
                  {noPrice ? (
                    <span className="text-red-500 text-sm">—</span>
                  ) : (
                    <div>
                      <div className="text-sm font-semibold text-white">
                        {Number(p.price).toLocaleString('uk-UA')} ₴
                      </div>
                      {p.price_old && (
                        <div className="text-xs text-zinc-600 line-through">
                          {Number(p.price_old).toLocaleString('uk-UA')} ₴
                        </div>
                      )}
                    </div>
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

                {/* Weight */}
                <div className="text-xs text-zinc-500 text-center">
                  {weight ?? <span className="text-zinc-700">—</span>}
                </div>

                {/* Status */}
                <div className="text-center">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    p.status === 'active'
                      ? 'bg-emerald-950 text-emerald-400'
                      : 'bg-zinc-800 text-zinc-500'
                  }`}>
                    {p.status === 'active' ? 'Актив' : p.status}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <div className="text-xs text-zinc-500">
            Сторінка {page} з {totalPages} · {total} товарів
          </div>
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
        </div>
      )}
    </div>
  )
}

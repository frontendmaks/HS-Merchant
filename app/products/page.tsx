import { createServiceClient } from '@/lib/supabase/service'
import { Suspense } from 'react'
import ProductsToolbar from './ProductsToolbar'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

const PER_PAGE = 50

async function getProducts(q: string, page: number) {
  const supabase = createServiceClient()
  const from = (page - 1) * PER_PAGE
  const to = from + PER_PAGE - 1

  let query = supabase
    .from('products')
    .select('id, name, sku, price, stock, status, images, external_id', { count: 'exact' })
    .order('name')
    .range(from, to)

  if (q) query = query.ilike('name', `%${q}%`)

  const { data, count } = await query
  return { products: data ?? [], total: count ?? 0 }
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>
}) {
  const { q = '', page: pageStr = '1' } = await searchParams
  const page = Math.max(1, parseInt(pageStr) || 1)
  const { products, total } = await getProducts(q, page)
  const totalPages = Math.ceil(total / PER_PAGE)

  return (
    <div className="max-w-6xl">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Товари</h1>
          <p className="text-zinc-500 text-sm mt-1">Каталог товарів синхронізований з WooCommerce</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="mb-4">
        <Suspense>
          <ProductsToolbar total={total} />
        </Suspense>
      </div>

      {/* Table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-[56px_1fr_120px_100px_80px_80px] gap-4 px-4 py-3 border-b border-zinc-800 bg-zinc-800/50">
          <div className="text-xs text-zinc-500 uppercase tracking-wide">Фото</div>
          <div className="text-xs text-zinc-500 uppercase tracking-wide">Назва / Артикул</div>
          <div className="text-xs text-zinc-500 uppercase tracking-wide">WC ID</div>
          <div className="text-xs text-zinc-500 uppercase tracking-wide text-right">Ціна</div>
          <div className="text-xs text-zinc-500 uppercase tracking-wide text-right">Сток</div>
          <div className="text-xs text-zinc-500 uppercase tracking-wide text-center">Статус</div>
        </div>

        {/* Rows */}
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
            const zeroStock = p.stock === 0 && p.status === 'active'

            return (
              <div
                key={p.id}
                className="grid grid-cols-[56px_1fr_120px_100px_80px_80px] gap-4 px-4 py-3 items-center hover:bg-zinc-800/40 transition-colors"
              >
                {/* Image */}
                <div className="w-10 h-10 rounded-lg overflow-hidden bg-zinc-800 shrink-0">
                  {img ? (
                    <img src={img} alt={p.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-zinc-600 text-lg">□</div>
                  )}
                </div>

                {/* Name */}
                <div className="min-w-0">
                  <div className="text-sm text-white truncate flex items-center gap-2">
                    {p.name}
                    {noImg && <span title="Немає фото" className="text-amber-500 text-xs shrink-0">📷</span>}
                    {noPrice && <span title="Немає ціни" className="text-red-500 text-xs shrink-0">₴</span>}
                  </div>
                  <div className="text-xs text-zinc-600 mt-0.5">
                    {p.sku ? `SKU: ${p.sku}` : <span className="text-zinc-700">без артикулу</span>}
                  </div>
                </div>

                {/* WC ID */}
                <div>
                  {p.external_id ? (
                    <a
                      href={`https://halytska-svizhyna.ua/?p=${p.external_id}`}
                      target="_blank"
                      className="text-xs text-zinc-500 hover:text-red-400 font-mono"
                    >
                      #{p.external_id} ↗
                    </a>
                  ) : (
                    <span className="text-xs text-zinc-700">—</span>
                  )}
                </div>

                {/* Price */}
                <div className={`text-sm font-semibold text-right ${noPrice ? 'text-red-500' : 'text-white'}`}>
                  {noPrice ? '—' : `${Number(p.price).toLocaleString('uk-UA')} ₴`}
                </div>

                {/* Stock */}
                <div className={`text-sm text-right font-medium ${zeroStock ? 'text-red-400' : 'text-zinc-300'}`}>
                  {p.stock ?? '—'}
                  {zeroStock && <span className="ml-1 text-xs">⚠</span>}
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
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={`/products?${new URLSearchParams({ ...(q && { q }), page: String(page - 1) })}`}
                className="px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg transition-colors"
              >
                ← Попередня
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={`/products?${new URLSearchParams({ ...(q && { q }), page: String(page + 1) })}`}
                className="px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg transition-colors"
              >
                Наступна →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

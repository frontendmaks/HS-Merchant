import { createServiceClient } from '@/lib/supabase/service'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function ZeroStockPage() {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('products')
    .select('id, name, sku, external_id, price, images, category_name, brand, stock, updated_at')
    .eq('status', 'active')
    .eq('stock', 0)
    .order('name')

  const products = data ?? []

  // Group by category for summary
  const byCategory = products.reduce((acc: Record<string, number>, p) => {
    const cat = p.category_name ?? 'Без категорії'
    acc[cat] = (acc[cat] ?? 0) + 1
    return acc
  }, {})

  const topCategories = Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)

  function timeAgo(d: string | null) {
    if (!d) return '—'
    const diff = Date.now() - new Date(d).getTime()
    const h = Math.floor(diff / 3600000)
    if (h < 24) return `${h}год тому`
    return `${Math.floor(h / 24)}д тому`
  }

  return (
    <div className="w-full space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/" className="text-zinc-600 hover:text-zinc-400 text-sm transition-colors">← Дашборд</Link>
      </div>

      <div>
        <h1 className="text-2xl font-semibold text-white flex items-center gap-2">
          <span>🔴</span> Нульовий сток
        </h1>
        <p className="text-zinc-500 text-sm mt-1">Активні товари з нульовим залишком — не потраплять у фід як "в наявності"</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-[auto_1fr] gap-4">
        <div className="bg-zinc-900 border border-red-900/40 rounded-xl p-5 flex items-center gap-5">
          <div>
            <div className="text-4xl font-bold text-red-400">{products.length}</div>
            <div className="text-xs text-zinc-500 mt-1">Товарів з нульовим стоком</div>
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <div className="text-xs text-zinc-500 uppercase tracking-wide mb-3">Топ категорій з нульовим стоком</div>
          <div className="flex flex-wrap gap-2">
            {topCategories.map(([cat, count]) => (
              <div key={cat} className="flex items-center gap-2 bg-zinc-800 rounded-lg px-3 py-1.5">
                <span className="text-xs text-zinc-300">{cat}</span>
                <span className="text-xs font-semibold text-red-400">{count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="grid gap-3 px-5 py-3 border-b border-zinc-800 bg-zinc-800/50"
          style={{ gridTemplateColumns: '56px 1fr 160px 160px 100px 120px 100px' }}>
          <div className="text-xs text-zinc-500 uppercase tracking-wide">Фото</div>
          <div className="text-xs text-zinc-500 uppercase tracking-wide">Назва</div>
          <div className="text-xs text-zinc-500 uppercase tracking-wide">Категорія</div>
          <div className="text-xs text-zinc-500 uppercase tracking-wide">Бренд</div>
          <div className="text-xs text-zinc-500 uppercase tracking-wide text-right">Ціна</div>
          <div className="text-xs text-zinc-500 uppercase tracking-wide text-right">Оновлено</div>
          <div className="text-xs text-zinc-500 uppercase tracking-wide text-right">Дії</div>
        </div>

        <div className="divide-y divide-zinc-800">
          {products.length === 0 && (
            <div className="py-16 text-center">
              <div className="text-emerald-400 text-2xl mb-2">✓</div>
              <div className="text-zinc-500 text-sm">Всі активні товари є в наявності!</div>
            </div>
          )}
          {products.map(p => {
            const img = p.images?.[0]
            return (
              <div key={p.id}
                className="grid gap-3 px-5 py-3 items-center hover:bg-zinc-800/30 transition-colors"
                style={{ gridTemplateColumns: '56px 1fr 160px 160px 100px 120px 100px' }}>

                {/* Photo */}
                <div className="w-12 h-12 rounded-lg overflow-hidden bg-zinc-800 shrink-0">
                  {img ? (
                    <img src={img} alt={p.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-zinc-600 text-lg">□</div>
                  )}
                </div>

                {/* Name */}
                <div className="min-w-0">
                  <div className="text-sm text-white line-clamp-2 leading-snug">{p.name}</div>
                  {p.sku && <div className="text-xs text-zinc-700 font-mono mt-0.5">{p.sku}</div>}
                </div>

                {/* Category */}
                <div className="text-xs text-zinc-400 truncate">{p.category_name ?? '—'}</div>

                {/* Brand */}
                <div className="text-xs text-zinc-400 truncate">{p.brand ?? '—'}</div>

                {/* Price */}
                <div className="text-right text-sm font-medium text-white">
                  {p.price && Number(p.price) > 0
                    ? `${Number(p.price).toLocaleString('uk-UA')} ₴`
                    : <span className="text-zinc-600">—</span>
                  }
                </div>

                {/* Updated */}
                <div className="text-right text-xs text-zinc-600">{timeAgo(p.updated_at)}</div>

                {/* Actions */}
                <div className="flex justify-end">
                  {p.external_id && (
                    <a
                      href={`https://halytska-svizhyna.ua/wp-admin/post.php?post=${p.external_id}&action=edit`}
                      target="_blank"
                      className="text-xs px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 rounded-lg transition-colors whitespace-nowrap"
                    >
                      ✏️ WC
                    </a>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {products.length > 0 && (
          <div className="px-5 py-3 border-t border-zinc-800 text-xs text-zinc-600 text-center">
            {products.length} товарів з нульовим стоком · після поповнення зробіть синк з WC
          </div>
        )}
      </div>
    </div>
  )
}

import { createServiceClient } from '@/lib/supabase/service'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function ProblemsPage() {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('products')
    .select('id, name, sku, external_id, price, description, images, category_name, brand, stock, status')
    .eq('status', 'active')
    .order('name')

  const products = (data ?? []).map(p => {
    const issues: string[] = []
    if (!p.images?.length) issues.push('без фото')
    if (!p.price || Number(p.price) <= 0) issues.push('без ціни')
    if (!p.description) issues.push('без опису')
    return { ...p, issues }
  }).filter(p => p.issues.length > 0)

  const noPhoto    = products.filter(p => p.issues.includes('без фото')).length
  const noPrice    = products.filter(p => p.issues.includes('без ціни')).length
  const noDesc     = products.filter(p => p.issues.includes('без опису')).length

  const issueColor: Record<string, string> = {
    'без фото':  'bg-amber-950 text-amber-400',
    'без ціни':  'bg-orange-950 text-orange-400',
    'без опису': 'bg-blue-950 text-blue-400',
  }

  return (
    <div className="w-full space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/" className="text-zinc-600 hover:text-zinc-400 text-sm transition-colors">← Дашборд</Link>
      </div>

      <div>
        <h1 className="text-2xl font-semibold text-white flex items-center gap-2">
          <span className="text-amber-400">⚠️</span> Проблемні товари
        </h1>
        <p className="text-zinc-500 text-sm mt-1">Активні товари з відсутніми даними — потребують уваги перед публікацією у фід</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <div className="text-2xl font-bold text-white">{products.length}</div>
          <div className="text-xs text-zinc-500 mt-1">Всього проблемних</div>
        </div>
        <div className="bg-zinc-900 border border-amber-900/40 rounded-xl p-4">
          <div className="text-2xl font-bold text-amber-400">{noPhoto}</div>
          <div className="text-xs text-zinc-500 mt-1">Без фото</div>
        </div>
        <div className="bg-zinc-900 border border-orange-900/40 rounded-xl p-4">
          <div className="text-2xl font-bold text-orange-400">{noPrice}</div>
          <div className="text-xs text-zinc-500 mt-1">Без ціни</div>
        </div>
        <div className="bg-zinc-900 border border-blue-900/40 rounded-xl p-4">
          <div className="text-2xl font-bold text-blue-400">{noDesc}</div>
          <div className="text-xs text-zinc-500 mt-1">Без опису</div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="grid gap-3 px-5 py-3 border-b border-zinc-800 bg-zinc-800/50"
          style={{ gridTemplateColumns: '56px 1fr 140px 140px 120px 120px' }}>
          <div className="text-xs text-zinc-500 uppercase tracking-wide">Фото</div>
          <div className="text-xs text-zinc-500 uppercase tracking-wide">Назва / Категорія</div>
          <div className="text-xs text-zinc-500 uppercase tracking-wide">Бренд</div>
          <div className="text-xs text-zinc-500 uppercase tracking-wide">Проблеми</div>
          <div className="text-xs text-zinc-500 uppercase tracking-wide text-right">Ціна</div>
          <div className="text-xs text-zinc-500 uppercase tracking-wide text-right">Дії</div>
        </div>

        <div className="divide-y divide-zinc-800">
          {products.map(p => {
            const img = p.images?.[0]
            return (
              <div key={p.id}
                className="grid gap-3 px-5 py-3 items-center hover:bg-zinc-800/30 transition-colors"
                style={{ gridTemplateColumns: '56px 1fr 140px 120px 120px 120px' }}>

                {/* Photo */}
                <div className="w-12 h-12 rounded-lg overflow-hidden bg-zinc-800 shrink-0">
                  {img ? (
                    <img src={img} alt={p.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-amber-600 text-lg">📷</div>
                  )}
                </div>

                {/* Name */}
                <div className="min-w-0">
                  <div className="text-sm text-white leading-snug line-clamp-2">{p.name}</div>
                  <div className="text-xs text-zinc-600 mt-0.5">{p.category_name ?? '—'}</div>
                  {p.sku && <div className="text-xs text-zinc-700 font-mono">{p.sku}</div>}
                </div>

                {/* Brand */}
                <div className="text-xs text-zinc-400 truncate">{p.brand ?? '—'}</div>

                {/* Issues */}
                <div className="flex flex-wrap gap-1">
                  {p.issues.map(issue => (
                    <span key={issue} className={`text-xs px-1.5 py-0.5 rounded ${issueColor[issue]}`}>
                      {issue}
                    </span>
                  ))}
                </div>

                {/* Price */}
                <div className="text-right">
                  {p.price && Number(p.price) > 0
                    ? <span className="text-sm text-white font-medium">{Number(p.price).toLocaleString('uk-UA')} ₴</span>
                    : <span className="text-orange-400 text-sm">—</span>
                  }
                </div>

                {/* Actions */}
                <div className="flex justify-end gap-2">
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
      </div>
    </div>
  )
}

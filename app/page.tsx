import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

async function getStats() {
  const supabase = createServiceClient()
  const [products, feeds, marketplaces, changelog, feedActiveCounts] = await Promise.all([
    supabase.from('products').select('id, name, status, stock, price, description, images, sku, updated_at').eq('status', 'active'),
    supabase.from('feeds').select(`
      id, status, slug, name, updated_at,
      marketplace:marketplaces(id, name, slug)
    `, { count: 'exact' }),
    supabase.from('marketplaces').select('id, name, slug', { count: 'exact' }),
    supabase.from('product_changelog').select('*').order('created_at', { ascending: false }).limit(8),
    supabase.from('feed_products').select('feed_id').eq('is_active', true),
  ])

  const allProducts = products.data ?? []

  // Проблемні товари
  const problematic = allProducts.filter(p => {
    const noImages = !p.images || (Array.isArray(p.images) && (p.images as string[]).length === 0)
    const noPrice = !p.price || p.price <= 0
    const noDesc = !p.description || p.description.trim() === ''
    return noImages || noPrice || noDesc
  }).map(p => {
    const noImages = !p.images || (Array.isArray(p.images) && (p.images as string[]).length === 0)
    const noPrice = !p.price || p.price <= 0
    const noDesc = !p.description || p.description.trim() === ''
    return {
      ...p,
      issues: [
        noImages && 'без фото',
        noPrice  && 'без ціни',
        noDesc   && 'без опису',
      ].filter(Boolean) as string[],
    }
  })

  // Нульовий сток
  const zeroStock = allProducts.filter(p => p.stock === 0)

  // Підрахунок активних товарів по фідах
  const feedCountMap = new Map<string, number>()
  for (const row of feedActiveCounts.data ?? []) {
    feedCountMap.set(row.feed_id, (feedCountMap.get(row.feed_id) ?? 0) + 1)
  }

  const marketplaceNames = (marketplaces.data ?? []).map(m => m.name).join(', ')

  return {
    totalProducts: allProducts.length,
    totalFeeds: feeds.count ?? 0,
    activeFeeds: feeds.data?.filter(f => f.status === 'active').length ?? 0,
    totalMarketplaces: marketplaces.count ?? 0,
    marketplaceNames,
    feeds: (feeds.data ?? []).map(f => ({ ...f, activeProductCount: feedCountMap.get(f.id) ?? 0 })),
    problematic,
    zeroStock,
    changelog: changelog.data ?? [],
  }
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'ніколи'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}хв тому`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}год тому`
  return `${Math.floor(hours / 24)}д тому`
}

export default async function Dashboard() {
  const { getCurrentRole } = await import('@/lib/getRole')
  const { redirect } = await import('next/navigation')
  const role = await getCurrentRole()
  if (role === 'operator') redirect('/orders')

  const stats = await getStats()

  const cards = [
    { label: 'Товарів в каталозі', value: stats.totalProducts,    sub: `активних у базі`,           color: 'border-red-600'     },
    { label: 'XML фідів',          value: stats.totalFeeds,        sub: `${stats.activeFeeds} активних`,  color: 'border-blue-500'    },
    { label: 'Маркетплейси',       value: stats.totalMarketplaces, sub: stats.marketplaceNames || 'немає', color: 'border-emerald-500' },
  ]

  return (
    <div className="w-full space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-white">Дашборд</h1>
        <p className="text-zinc-500 text-sm mt-1">Керування XML фідами для маркетплейсів</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {cards.map(card => (
          <div key={card.label} className={`bg-zinc-900 border border-zinc-800 border-l-2 ${card.color} rounded-xl p-5`}>
            <div className="text-3xl font-bold text-white mb-1">{card.value}</div>
            <div className="text-sm font-medium text-zinc-300">{card.label}</div>
            <div className="text-xs text-zinc-500 mt-1">{card.sub}</div>
          </div>
        ))}
      </div>

      {/* Alerts row */}
      <div className="grid grid-cols-2 gap-4">
        {/* Проблемні товари */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl">
          <div className="px-5 py-3.5 border-b border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-amber-400">⚠️</span>
              <h2 className="text-sm font-semibold text-white">Проблемні товари</h2>
              {stats.problematic.length > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-950 text-amber-400 font-medium">
                  {stats.problematic.length}
                </span>
              )}
            </div>
            <a href="/products/problems" className="text-xs text-zinc-500 hover:text-red-400">Всі →</a>
          </div>
          <div className="divide-y divide-zinc-800">
            {stats.problematic.length === 0 ? (
              <div className="px-5 py-6 text-center">
                <div className="text-emerald-400 text-lg mb-1">✓</div>
                <div className="text-xs text-zinc-500">Всі товари заповнені</div>
              </div>
            ) : stats.problematic.slice(0, 4).map(p => (
              <div key={p.id} className="px-5 py-3 flex items-center justify-between gap-3">
                <div className="text-sm text-zinc-300 truncate">{p.name}</div>
                <div className="flex gap-1 shrink-0">
                  {p.issues.map(issue => (
                    <span key={issue} className="text-xs px-1.5 py-0.5 rounded bg-amber-950 text-amber-400">
                      {issue}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {stats.problematic.length > 4 && (
              <div className="px-5 py-2 text-xs text-zinc-600 text-center">
                ще {stats.problematic.length - 4} товарів...
              </div>
            )}
          </div>
        </div>

        {/* Нульовий сток */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl">
          <div className="px-5 py-3.5 border-b border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span>🔴</span>
              <h2 className="text-sm font-semibold text-white">Нульовий сток</h2>
              {stats.zeroStock.length > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-red-950 text-red-400 font-medium">
                  {stats.zeroStock.length}
                </span>
              )}
            </div>
            <a href="/products/zero-stock" className="text-xs text-zinc-500 hover:text-red-400">Всі →</a>
          </div>
          <div className="divide-y divide-zinc-800">
            {stats.zeroStock.length === 0 ? (
              <div className="px-5 py-6 text-center">
                <div className="text-emerald-400 text-lg mb-1">✓</div>
                <div className="text-xs text-zinc-500">Всі активні товари є в наявності</div>
              </div>
            ) : stats.zeroStock.slice(0, 4).map(p => (
              <div key={p.id} className="px-5 py-3 flex items-center justify-between gap-3">
                <div className="text-sm text-zinc-300 truncate">{p.name}</div>
                <span className="text-xs px-1.5 py-0.5 rounded bg-red-950 text-red-400 shrink-0">
                  0 шт
                </span>
              </div>
            ))}
            {stats.zeroStock.length > 4 && (
              <div className="px-5 py-2 text-xs text-zinc-600 text-center">
                ще {stats.zeroStock.length - 4} товарів...
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Feeds table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl">
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span>🔄</span>
            <h2 className="text-sm font-semibold text-white">XML фіди по маркетплейсах</h2>
          </div>
          <a href="/feeds" className="text-xs text-red-500 hover:text-red-400">Всі фіди →</a>
        </div>
        <div className="grid grid-cols-[1fr_160px_80px_100px_140px] gap-4 px-6 py-2 border-b border-zinc-800/50">
          <div className="text-xs text-zinc-600 uppercase tracking-wide">Фід / Маркетплейс</div>
          <div className="text-xs text-zinc-600 uppercase tracking-wide">URL</div>
          <div className="text-xs text-zinc-600 uppercase tracking-wide text-right">Товарів</div>
          <div className="text-xs text-zinc-600 uppercase tracking-wide text-center">Статус</div>
          <div className="text-xs text-zinc-600 uppercase tracking-wide text-right">Оновлено</div>
        </div>
        <div className="divide-y divide-zinc-800">
          {stats.feeds.length === 0 && (
            <div className="px-6 py-8 text-center text-zinc-600 text-sm">
              Фідів ще немає. <a href="/feeds" className="text-red-500">Створити</a>
            </div>
          )}
          {stats.feeds.map((feed: any) => {
            const productCount = feed.activeProductCount ?? 0
            const marketplace = feed.marketplace
            return (
              <div key={feed.id} className="grid grid-cols-[1fr_160px_80px_100px_140px] gap-4 px-6 py-4 items-center hover:bg-zinc-800/30 transition-colors">
                <div>
                  <div className="text-sm text-white font-medium">{feed.slug}</div>
                  {marketplace && (
                    <div className="text-xs text-zinc-500 mt-0.5 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-zinc-600 inline-block"></span>
                      {marketplace.name}
                    </div>
                  )}
                </div>
                <a
                  href={`https://hs-merchant.vercel.app/api/feeds/${feed.slug}`}
                  target="_blank"
                  className="text-xs text-zinc-500 hover:text-red-400 font-mono truncate"
                >
                  /api/feeds/{feed.slug} ↗
                </a>
                <div className="text-sm text-white font-semibold text-right">
                  {productCount}
                  <span className="text-xs text-zinc-500 font-normal ml-1">шт</span>
                </div>
                <div className="text-center">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    feed.status === 'active'
                      ? 'bg-emerald-950 text-emerald-400'
                      : 'bg-zinc-800 text-zinc-500'
                  }`}>
                    {feed.status === 'active' ? 'Активний' : feed.status}
                  </span>
                </div>
                <div className="text-xs text-zinc-500 text-right">{timeAgo(feed.updated_at)}</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Changelog */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl">
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span>📦</span>
            <h2 className="text-sm font-semibold text-white">Останні зміни товарів</h2>
          </div>
          <a href="/products" className="text-xs text-zinc-500 hover:text-red-400">Всі товари →</a>
        </div>
        <div className="divide-y divide-zinc-800">
          {stats.changelog.length === 0 && (
            <div className="px-6 py-8 text-center text-zinc-600 text-sm">
              Змін ще немає — вони з'являться після редагування товарів
            </div>
          )}
          {stats.changelog.map((entry: any) => {
            const isCreated = entry.change_type === 'created'
            const isDeleted = entry.change_type === 'deleted'
            const isUpdated = entry.change_type === 'updated'
            const fields: Record<string, { old: string; new: string }> = entry.changed_fields ?? {}

            const fieldLabels: Record<string, string> = {
              name: 'Назва', price: 'Ціна', stock: 'Сток',
              status: 'Статус', description: 'Опис', images: 'Фото', sku: 'Артикул',
            }

            return (
              <div key={entry.id} className="px-6 py-3.5 flex items-start gap-4">
                {/* Icon */}
                <div className={`mt-0.5 w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0 ${
                  isCreated ? 'bg-emerald-950 text-emerald-400' :
                  isDeleted ? 'bg-red-950 text-red-400' :
                  'bg-blue-950 text-blue-400'
                }`}>
                  {isCreated ? '+' : isDeleted ? '×' : '↻'}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-white font-medium truncate">{entry.product_name}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      isCreated ? 'bg-emerald-950 text-emerald-400' :
                      isDeleted ? 'bg-red-950 text-red-400' :
                      'bg-blue-950 text-blue-400'
                    }`}>
                      {isCreated ? 'додано' : isDeleted ? 'видалено' : 'змінено'}
                    </span>
                  </div>

                  {/* Changed fields */}
                  {isUpdated && Object.keys(fields).length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {Object.entries(fields).map(([key, val]) => (
                        <div key={key} className="text-xs text-zinc-500 bg-zinc-800 rounded px-2 py-1">
                          <span className="text-zinc-400">{fieldLabels[key] ?? key}:</span>{' '}
                          <span className="line-through text-zinc-600">{val.old ?? '—'}</span>
                          {' → '}
                          <span className="text-zinc-300">{val.new ?? '—'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Time */}
                <div className="text-xs text-zinc-600 shrink-0 mt-0.5">{timeAgo(entry.created_at)}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

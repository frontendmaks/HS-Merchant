import { createServiceClient } from '@/lib/supabase/service'

async function getStats() {
  const supabase = createServiceClient()
  const [products, feeds, marketplaces] = await Promise.all([
    supabase.from('products').select('id, name, status, stock, price, description, images, sku, updated_at'),
    supabase.from('feeds').select(`
      id, status, slug, updated_at,
      marketplace:marketplaces(id, name, slug),
      feed_products(count)
    `, { count: 'exact' }),
    supabase.from('marketplaces').select('id, name, slug', { count: 'exact' }),
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
  const zeroStock = allProducts.filter(p => p.status === 'active' && p.stock === 0)

  // Останні зміни
  const recentlyUpdated = [...allProducts]
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 5)

  return {
    totalProducts: allProducts.length,
    activeProducts: allProducts.filter(p => p.status === 'active').length,
    totalFeeds: feeds.count ?? 0,
    activeFeeds: feeds.data?.filter(f => f.status === 'active').length ?? 0,
    totalMarketplaces: marketplaces.count ?? 0,
    feeds: feeds.data ?? [],
    problematic,
    zeroStock,
    recentlyUpdated,
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
  const stats = await getStats()

  const cards = [
    { label: 'Товарів в каталозі', value: stats.totalProducts,    sub: `${stats.activeProducts} активних`,  color: 'border-red-600'     },
    { label: 'XML фідів',          value: stats.totalFeeds,        sub: `${stats.activeFeeds} активних`,     color: 'border-blue-500'    },
    { label: 'Маркетплейси',       value: stats.totalMarketplaces, sub: 'Rozetka, Prom, MauDau',             color: 'border-emerald-500' },
  ]

  return (
    <div className="max-w-5xl space-y-6">
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
            <a href="/products" className="text-xs text-zinc-500 hover:text-red-400">Всі →</a>
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
            <a href="/products" className="text-xs text-zinc-500 hover:text-red-400">Всі →</a>
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
            const productCount = feed.feed_products?.[0]?.count ?? 0
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

      {/* Recently updated products */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl">
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span>📦</span>
            <h2 className="text-sm font-semibold text-white">Останні зміни товарів</h2>
          </div>
          <a href="/products" className="text-xs text-zinc-500 hover:text-red-400">Всі товари →</a>
        </div>
        <div className="divide-y divide-zinc-800">
          {stats.recentlyUpdated.map(p => (
            <div key={p.id} className="px-6 py-3 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.status === 'active' ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                <div className="text-sm text-zinc-300 truncate">{p.name}</div>
                {p.sku && <div className="text-xs text-zinc-600 font-mono shrink-0">{p.sku}</div>}
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <div className="text-sm text-white font-medium">{p.price} ₴</div>
                <div className="text-xs text-zinc-500">{timeAgo(p.updated_at)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

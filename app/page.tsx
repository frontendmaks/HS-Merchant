import { createServiceClient } from '@/lib/supabase/service'

async function getStats() {
  const supabase = createServiceClient()
  const [products, feeds, marketplaces] = await Promise.all([
    supabase.from('products').select('id, status', { count: 'exact' }),
    supabase.from('feeds').select(`
      id, status, slug, updated_at,
      marketplace:marketplaces(id, name, slug),
      feed_products(count)
    `, { count: 'exact' }),
    supabase.from('marketplaces').select('id, name, slug', { count: 'exact' }),
  ])
  return {
    totalProducts: products.count ?? 0,
    activeProducts: products.data?.filter(p => p.status === 'active').length ?? 0,
    totalFeeds: feeds.count ?? 0,
    activeFeeds: feeds.data?.filter(f => f.status === 'active').length ?? 0,
    totalMarketplaces: marketplaces.count ?? 0,
    feeds: feeds.data ?? [],
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
    { label: 'Товарів в каталозі', value: stats.totalProducts,    sub: `${stats.activeProducts} активних`,       color: 'border-red-600'     },
    { label: 'XML фідів',          value: stats.totalFeeds,        sub: `${stats.activeFeeds} активних`,          color: 'border-blue-500'    },
    { label: 'Маркетплейси',       value: stats.totalMarketplaces, sub: 'Rozetka, Prom, MauDau',                  color: 'border-emerald-500' },
  ]

  return (
    <div className="max-w-5xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-white">Дашборд</h1>
        <p className="text-zinc-500 text-sm mt-1">Керування XML фідами для маркетплейсів</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {cards.map(card => (
          <div key={card.label} className={`bg-zinc-900 border border-zinc-800 border-l-2 ${card.color} rounded-xl p-5`}>
            <div className="text-3xl font-bold text-white mb-1">{card.value}</div>
            <div className="text-sm font-medium text-zinc-300">{card.label}</div>
            <div className="text-xs text-zinc-500 mt-1">{card.sub}</div>
          </div>
        ))}
      </div>

      {/* Feeds table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl">
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">XML фіди по маркетплейсах</h2>
          <a href="/feeds" className="text-xs text-red-500 hover:text-red-400">Всі фіди →</a>
        </div>

        {/* Table header */}
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
                {/* Feed + marketplace */}
                <div>
                  <div className="text-sm text-white font-medium">{feed.slug}</div>
                  {marketplace && (
                    <div className="text-xs text-zinc-500 mt-0.5 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-zinc-600 inline-block"></span>
                      {marketplace.name}
                    </div>
                  )}
                </div>

                {/* URL */}
                <a
                  href={`https://hs-merchant.vercel.app/api/feeds/${feed.slug}`}
                  target="_blank"
                  className="text-xs text-zinc-500 hover:text-red-400 font-mono truncate"
                >
                  /api/feeds/{feed.slug} ↗
                </a>

                {/* Product count */}
                <div className="text-sm text-white font-semibold text-right">
                  {productCount}
                  <span className="text-xs text-zinc-500 font-normal ml-1">шт</span>
                </div>

                {/* Status */}
                <div className="text-center">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    feed.status === 'active'
                      ? 'bg-emerald-950 text-emerald-400'
                      : 'bg-zinc-800 text-zinc-500'
                  }`}>
                    {feed.status === 'active' ? 'Активний' : feed.status}
                  </span>
                </div>

                {/* Updated at */}
                <div className="text-xs text-zinc-500 text-right">
                  {timeAgo(feed.updated_at)}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

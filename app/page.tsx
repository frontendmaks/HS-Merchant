import { createServiceClient } from '@/lib/supabase/service'

async function getStats() {
  const supabase = createServiceClient()
  const [products, feeds, feedProducts] = await Promise.all([
    supabase.from('products').select('id, status', { count: 'exact' }),
    supabase.from('feeds').select('id, status, marketplace_id, slug, updated_at, feed_products(count)', { count: 'exact' }),
    supabase.from('feed_products').select('id', { count: 'exact' }),
  ])
  return {
    totalProducts: products.count ?? 0,
    activeProducts: products.data?.filter(p => p.status === 'active').length ?? 0,
    totalFeeds: feeds.count ?? 0,
    activeFeeds: feeds.data?.filter(f => f.status === 'active').length ?? 0,
    feeds: feeds.data ?? [],
  }
}

export default async function Dashboard() {
  const stats = await getStats()

  const cards = [
    { label: 'Товарів в каталозі', value: stats.totalProducts, sub: `${stats.activeProducts} активних`, color: 'border-red-600' },
    { label: 'XML фідів',          value: stats.totalFeeds,    sub: `${stats.activeFeeds} активних`,    color: 'border-blue-500' },
    { label: 'Маркетплейси',       value: 3,                   sub: 'Rozetka, Prom, MauDau',             color: 'border-emerald-500' },
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

      {/* Active feeds */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl">
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Активні фіди</h2>
          <a href="/feeds" className="text-xs text-red-500 hover:text-red-400">Всі фіди →</a>
        </div>
        <div className="divide-y divide-zinc-800">
          {stats.feeds.length === 0 && (
            <div className="px-6 py-8 text-center text-zinc-600 text-sm">
              Фідів ще немає. <a href="/feeds" className="text-red-500">Створити</a>
            </div>
          )}
          {stats.feeds.map((feed: any) => (
            <div key={feed.id} className="px-6 py-4 flex items-center justify-between">
              <div>
                <div className="text-sm text-white font-medium">{feed.slug}</div>
                <div className="text-xs text-zinc-500 mt-0.5">
                  {feed.feed_products?.[0]?.count ?? 0} товарів
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  feed.status === 'active'
                    ? 'bg-emerald-950 text-emerald-400'
                    : 'bg-zinc-800 text-zinc-500'
                }`}>
                  {feed.status === 'active' ? 'Активний' : feed.status}
                </span>
                <a
                  href={`https://hs-merchant.vercel.app/api/feeds/${feed.slug}`}
                  target="_blank"
                  className="text-xs text-zinc-500 hover:text-red-400 font-mono"
                >
                  /api/feeds/{feed.slug} ↗
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

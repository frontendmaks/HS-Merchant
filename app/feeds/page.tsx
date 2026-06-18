import { createServiceClient } from '@/lib/supabase/service'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

async function getFeeds() {
  const supabase = createServiceClient()
  const [{ data: feeds }, { data: activeCounts }] = await Promise.all([
    supabase
      .from('feeds')
      .select('id, name, slug, status, last_generated_at, updated_at, settings, marketplace:marketplaces(id, name, slug)')
      .order('created_at', { ascending: false }),
    supabase
      .from('feed_products')
      .select('feed_id')
      .eq('is_active', true),
  ])

  const countMap = new Map<string, number>()
  for (const row of activeCounts ?? []) {
    countMap.set(row.feed_id, (countMap.get(row.feed_id) ?? 0) + 1)
  }

  return (feeds ?? []).map(f => ({ ...f, activeProductCount: countMap.get(f.id) ?? 0 }))
}

function timeAgo(d: string | null) {
  if (!d) return 'ніколи'
  const diff = Date.now() - new Date(d).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 60) return `${m}хв тому`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}год тому`
  return `${Math.floor(h / 24)}д тому`
}

const triggerLabel: Record<string, string> = {
  manual: '🖱 Вручну',
  scheduled: '⏱ Розклад',
  webhook: '🔗 Вебхук',
}

export default async function FeedsPage() {
  const feeds = await getFeeds()

  return (
    <div className="max-w-5xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">XML Фіди</h1>
          <p className="text-zinc-500 text-sm mt-1">Керування фідами для маркетплейсів</p>
        </div>
        <Link
          href="/feeds/new"
          className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          + Новий фід
        </Link>
      </div>

      <div className="space-y-3">
        {feeds.length === 0 && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-6 py-12 text-center text-zinc-600">
            Фідів ще немає. <Link href="/feeds/new" className="text-red-500">Створити перший</Link>
          </div>
        )}
        {feeds.map((feed: any) => {
          const trigger = feed.settings?.trigger ?? 'manual'
          const productCount = feed.activeProductCount ?? 0
          const filterType = feed.settings?.filter?.type ?? 'all'

          return (
            <Link key={feed.id} href={`/feeds/${feed.id}`}>
              <div className="bg-zinc-900 border border-zinc-800 hover:border-zinc-600 rounded-xl px-6 py-4 transition-colors cursor-pointer">
                <div className="flex items-center justify-between gap-4">
                  {/* Left */}
                  <div className="flex items-center gap-4 min-w-0">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-white font-medium">{feed.name}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          feed.status === 'active'
                            ? 'bg-emerald-950 text-emerald-400'
                            : feed.status === 'draft'
                            ? 'bg-zinc-800 text-zinc-500'
                            : 'bg-red-950 text-red-400'
                        }`}>
                          {feed.status === 'active' ? 'Активний' : feed.status === 'draft' ? 'Чернетка' : feed.status}
                        </span>
                      </div>
                      <div className="text-xs text-zinc-500 mt-1 font-mono">
                        /api/feeds/{feed.slug}
                      </div>
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="flex items-center gap-6 shrink-0 text-sm">
                    <div className="text-center">
                      <div className="text-white font-semibold">{productCount}</div>
                      <div className="text-xs text-zinc-600">товарів</div>
                    </div>
                    <div className="text-center">
                      <div className="text-zinc-300">{feed.marketplace?.name ?? '—'}</div>
                      <div className="text-xs text-zinc-600">маркетплейс</div>
                    </div>
                    <div className="text-center">
                      <div className="text-zinc-300 text-xs">{triggerLabel[trigger] ?? trigger}</div>
                      <div className="text-xs text-zinc-600">тригер</div>
                    </div>
                    <div className="text-center">
                      <div className="text-zinc-300 text-xs capitalize">
                        {filterType === 'all' ? 'Всі товари' : filterType === 'categories' ? 'За категоріями' : 'Вибрані'}
                      </div>
                      <div className="text-xs text-zinc-600">фільтр</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-zinc-400">{timeAgo(feed.last_generated_at)}</div>
                      <div className="text-xs text-zinc-600">генерація</div>
                    </div>
                    <div className="text-zinc-500 text-lg">→</div>
                  </div>
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

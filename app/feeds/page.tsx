import { createServiceClient } from '@/lib/supabase/service'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

async function getFeeds() {
  const supabase = createServiceClient()
  const [{ data: feeds }, { data: activeCounts }, { data: accessLogs }] = await Promise.all([
    supabase
      .from('feeds')
      .select('id, name, slug, status, last_accessed_at, access_count, updated_at, settings, marketplace:marketplaces(id, name, slug)')
      .order('created_at', { ascending: false }),
    supabase
      .from('feed_products')
      .select('feed_id')
      .eq('is_active', true),
    supabase
      .from('feed_access_logs')
      .select('feed_id, accessed_at, errors_count, auto_synced')
      .gte('accessed_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .order('accessed_at', { ascending: false }),
  ])

  const countMap = new Map<string, number>()
  for (const row of activeCounts ?? []) {
    countMap.set(row.feed_id, (countMap.get(row.feed_id) ?? 0) + 1)
  }

  const now = Date.now()
  const day = 24 * 60 * 60 * 1000
  const statsMap = new Map<string, { day: number; week: number; errors: number }>()
  for (const log of accessLogs ?? []) {
    const s = statsMap.get(log.feed_id) ?? { day: 0, week: 0, errors: 0 }
    s.week++
    if (now - new Date(log.accessed_at).getTime() < day) s.day++
    s.errors += log.errors_count ?? 0
    statsMap.set(log.feed_id, s)
  }

  return (feeds ?? []).map(f => ({
    ...f,
    activeProductCount: countMap.get(f.id) ?? 0,
    stats: statsMap.get(f.id) ?? { day: 0, week: 0, errors: 0 },
  }))
}

function timeAgo(d: string | null) {
  if (!d) return null
  const diff = Date.now() - new Date(d).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'щойно'
  if (m < 60) return `${m}хв тому`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}год тому`
  return `${Math.floor(h / 24)}д тому`
}

function formatDate(d: string | null) {
  if (!d) return null
  const dt = new Date(d)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(dt.getDate())}.${pad(dt.getMonth() + 1)} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`
}

const triggerLabel: Record<string, string> = {
  manual: '🖱 Вручну',
  scheduled: '⏱ Розклад',
  webhook: '🔗 Вебхук',
}

export default async function FeedsPage() {
  const { getCurrentRole } = await import('@/lib/getRole')
  const { redirect } = await import('next/navigation')
  const role = await getCurrentRole()
  if (role === 'operator') redirect('/orders')

  const feeds = await getFeeds()

  return (
    <div className="w-full">
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

      <div className="space-y-4">
        {feeds.length === 0 && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-6 py-12 text-center text-zinc-600">
            Фідів ще немає. <Link href="/feeds/new" className="text-red-500">Створити перший</Link>
          </div>
        )}
        {feeds.map((feed: any) => {
          const trigger = feed.settings?.trigger ?? 'manual'
          const productCount = feed.activeProductCount ?? 0
          const stats = feed.stats as { day: number; week: number; errors: number }

          return (
            <Link key={feed.id} href={`/feeds/${feed.id}`}>
              <div className="bg-zinc-900 border border-zinc-800 hover:border-zinc-600 rounded-xl px-6 py-5 transition-colors cursor-pointer">
                <div className="flex items-center justify-between gap-4">
                  {/* Left */}
                  <div className="min-w-0">
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

                  {/* Stats */}
                  <div className="flex items-center gap-6 shrink-0 text-sm">
                    {/* Product count */}
                    <div className="text-center">
                      <div className="text-white font-semibold">{productCount}</div>
                      <div className="text-xs text-zinc-600">товарів</div>
                    </div>

                    {/* Marketplace */}
                    <div className="text-center">
                      <div className="text-zinc-300">{feed.marketplace?.name ?? '—'}</div>
                      <div className="text-xs text-zinc-600">маркетплейс</div>
                    </div>

                    {/* Trigger */}
                    <div className="text-center">
                      <div className="text-zinc-300 text-xs">{triggerLabel[trigger] ?? trigger}</div>
                      <div className="text-xs text-zinc-600">тригер</div>
                    </div>

                    {/* Access count */}
                    <div className="text-center min-w-[60px]">
                      <div className="flex items-center justify-center gap-2">
                        <span className="text-white font-semibold">{stats.day}</span>
                        <span className="text-zinc-600 text-xs">/</span>
                        <span className="text-zinc-400">{stats.week}</span>
                      </div>
                      <div className="text-xs text-zinc-600">звернень д/тиж</div>
                    </div>

                    {/* Errors */}
                    <div className="text-center min-w-[48px]">
                      <div className={`font-semibold ${stats.errors > 0 ? 'text-red-400' : 'text-zinc-600'}`}>
                        {stats.errors > 0 ? stats.errors : '—'}
                      </div>
                      <div className="text-xs text-zinc-600">помилок</div>
                    </div>

                    {/* Last access */}
                    <div className="text-center min-w-[90px]">
                      {feed.last_accessed_at ? (
                        <>
                          <div className="text-emerald-400 text-xs font-mono">{formatDate(feed.last_accessed_at)}</div>
                          <div className="text-zinc-600 text-xs">{timeAgo(feed.last_accessed_at)}</div>
                        </>
                      ) : (
                        <div className="text-zinc-600 text-xs">не зверталися</div>
                      )}
                      <div className="text-xs text-zinc-500 mt-0.5">останнє звернення</div>
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

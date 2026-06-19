import { createServiceClient } from '@/lib/supabase/service'
import SyncTrigger from './SyncTrigger'
import MarketplaceSyncTrigger from './MarketplaceSyncTrigger'

export const dynamic = 'force-dynamic'

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'щойно'
  if (m < 60) return `${m}хв тому`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}год тому`
  return `${Math.floor(h / 24)}д тому`
}

function formatDate(d: string) {
  return new Date(d).toLocaleString('uk-UA', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default async function SyncsPage() {
  const supabase = createServiceClient()

  const [{ data: wcLogs }, { data: orderLogs }] = await Promise.all([
    supabase.from('sync_logs').select('*').order('created_at', { ascending: false }).limit(30),
    supabase.from('order_sync_logs').select('*').order('created_at', { ascending: false }).limit(30),
  ])

  const wcEntries = wcLogs ?? []
  const orderEntries = orderLogs ?? []

  // WC stats
  const wcLastSuccess = wcEntries.find(l => l.status === 'success')
  const wcFailed = wcEntries.filter(l => l.status === 'error').length
  const wcAvgDuration = wcEntries.filter(l => l.duration_ms).reduce((s, l, _, a) => s + l.duration_ms / a.length, 0)

  // Orders stats
  const ordLastSuccess = orderEntries.find(l => l.status === 'success')
  const ordFailed = orderEntries.filter(l => l.status === 'error').length
  const ordAvgDuration = orderEntries.filter(l => l.duration_ms).reduce((s, l, _, a) => s + l.duration_ms / a.length, 0)

  return (
    <div className="w-full space-y-10">

      {/* ── ТОВАРИ (WooCommerce) ── */}
      <section className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-white">Синхронізації товарів</h1>
            <p className="text-zinc-500 text-sm mt-1">Журнал синків з WooCommerce</p>
          </div>
          <SyncTrigger />
        </div>

        {/* WC schedule */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="w-9 h-9 rounded-lg bg-blue-950 flex items-center justify-center text-blue-400 text-lg shrink-0">⏱</div>
            <div>
              <div className="text-sm font-medium text-white">Автоматичний розклад</div>
              <div className="text-xs text-zinc-500 mt-0.5">
                Vercel Cron запускає синк щодня о 03:00: <span className="font-mono text-zinc-400">0 3 * * *</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-6 text-center shrink-0">
            <div>
              <div className="text-xs text-zinc-500">Розклад</div>
              <div className="text-sm text-blue-400 font-medium mt-0.5">Щодня о 03:00</div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">Захист від дублів</div>
              <div className="text-sm text-emerald-400 font-medium mt-0.5">2 хв cooldown</div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">Ендпоінт</div>
              <div className="text-xs font-mono text-zinc-400 mt-0.5">/api/cron/sync</div>
            </div>
          </div>
        </div>

        {/* WC stats */}
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <div className="text-2xl font-bold text-white">{wcEntries.length}</div>
            <div className="text-xs text-zinc-500 mt-1">Всього синків</div>
          </div>
          <div className="bg-zinc-900 border border-emerald-900/40 rounded-xl p-5">
            <div className="text-2xl font-bold text-emerald-400">
              {wcLastSuccess ? timeAgo(wcLastSuccess.created_at) : 'ніколи'}
            </div>
            <div className="text-xs text-zinc-500 mt-1">Останній успішний</div>
          </div>
          <div className={`bg-zinc-900 border rounded-xl p-5 ${wcFailed > 0 ? 'border-red-900/40' : 'border-zinc-800'}`}>
            <div className={`text-2xl font-bold ${wcFailed > 0 ? 'text-red-400' : 'text-zinc-400'}`}>{wcFailed}</div>
            <div className="text-xs text-zinc-500 mt-1">Помилок</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <div className="text-2xl font-bold text-zinc-300">
              {wcAvgDuration > 0 ? `${Math.round(wcAvgDuration / 1000)}с` : '—'}
            </div>
            <div className="text-xs text-zinc-500 mt-1">Середній час</div>
          </div>
        </div>

        {/* WC log table */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="grid gap-4 px-6 py-3 border-b border-zinc-800 bg-zinc-800/50"
            style={{ gridTemplateColumns: '160px 100px 80px 90px 90px 90px 90px 80px 1fr' }}>
            <div className="text-xs text-zinc-500 uppercase tracking-wide">Час</div>
            <div className="text-xs text-zinc-500 uppercase tracking-wide">Тригер</div>
            <div className="text-xs text-zinc-500 uppercase tracking-wide">Статус</div>
            <div className="text-xs text-zinc-500 uppercase tracking-wide text-right">Синкнуто</div>
            <div className="text-xs text-zinc-500 uppercase tracking-wide text-right">Деактив.</div>
            <div className="text-xs text-zinc-500 uppercase tracking-wide text-right">У WC</div>
            <div className="text-xs text-zinc-500 uppercase tracking-wide text-right">Зі складом</div>
            <div className="text-xs text-zinc-500 uppercase tracking-wide text-right">Час</div>
            <div className="text-xs text-zinc-500 uppercase tracking-wide">Помилка</div>
          </div>
          <div className="divide-y divide-zinc-800">
            {wcEntries.length === 0 && (
              <div className="py-10 text-center text-zinc-600">Синків ще не було</div>
            )}
            {wcEntries.map(log => (
              <div key={log.id}
                className="grid gap-4 px-6 py-3.5 items-center hover:bg-zinc-800/20 transition-colors"
                style={{ gridTemplateColumns: '160px 100px 80px 90px 90px 90px 90px 80px 1fr' }}>
                <div>
                  <div className="text-xs text-zinc-300">{formatDate(log.created_at)}</div>
                  <div className="text-xs text-zinc-600 mt-0.5">{timeAgo(log.created_at)}</div>
                </div>
                <div>
                  {log.trigger === 'cron'
                    ? <span className="text-xs px-2 py-0.5 rounded-full bg-blue-950 text-blue-400">⏱ Авто</span>
                    : <div>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400">🖱 Вручну</span>
                        {log.triggered_by && <div className="text-xs text-zinc-500 mt-0.5 truncate max-w-[90px]" title={log.triggered_by}>{log.triggered_by}</div>}
                      </div>}
                </div>
                <div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${log.status === 'success' ? 'bg-emerald-950 text-emerald-400' : 'bg-red-950 text-red-400'}`}>
                    {log.status === 'success' ? '✓ OK' : '✕ Error'}
                  </span>
                </div>
                <div className="text-right"><span className="text-sm font-semibold text-white">{log.synced}</span><span className="text-xs text-zinc-600 ml-1">шт</span></div>
                <div className="text-right">{log.deactivated > 0 ? <span className="text-sm font-semibold text-amber-400">{log.deactivated}</span> : <span className="text-sm text-zinc-600">0</span>}</div>
                <div className="text-right text-sm text-zinc-400">{log.total_wc}</div>
                <div className="text-right text-sm text-zinc-400">{log.with_warehouse_stock}</div>
                <div className="text-right text-xs text-zinc-500">{log.duration_ms ? `${(log.duration_ms / 1000).toFixed(1)}с` : '—'}</div>
                <div className="text-xs text-red-400 truncate">{log.error ?? <span className="text-zinc-700">—</span>}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── ЗАМОВЛЕННЯ (MauDau + Rozetka) ── */}
      <section className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-white">Синхронізації замовлень</h2>
            <p className="text-zinc-500 text-sm mt-1">MauDau + Rozetka → база даних</p>
          </div>
          <MarketplaceSyncTrigger />
        </div>

        {/* Orders schedule */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="w-9 h-9 rounded-lg bg-purple-950 flex items-center justify-center text-purple-400 text-lg shrink-0">⏱</div>
            <div>
              <div className="text-sm font-medium text-white">Автоматичний розклад</div>
              <div className="text-xs text-zinc-500 mt-0.5">
                Vercel Cron запускає синк щодня о 04:00: <span className="font-mono text-zinc-400">0 4 * * *</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-6 text-center shrink-0">
            <div>
              <div className="text-xs text-zinc-500">Розклад</div>
              <div className="text-sm text-purple-400 font-medium mt-0.5">Щодня о 04:00</div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">Платформи</div>
              <div className="text-sm text-white font-medium mt-0.5">MauDau + Rozetka</div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">Ендпоінт</div>
              <div className="text-xs font-mono text-zinc-400 mt-0.5">/api/cron/sync-orders</div>
            </div>
          </div>
        </div>

        {/* Orders stats */}
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <div className="text-2xl font-bold text-white">{orderEntries.length}</div>
            <div className="text-xs text-zinc-500 mt-1">Всього синків</div>
          </div>
          <div className="bg-zinc-900 border border-emerald-900/40 rounded-xl p-5">
            <div className="text-2xl font-bold text-emerald-400">
              {ordLastSuccess ? timeAgo(ordLastSuccess.created_at) : 'ніколи'}
            </div>
            <div className="text-xs text-zinc-500 mt-1">Останній успішний</div>
          </div>
          <div className={`bg-zinc-900 border rounded-xl p-5 ${ordFailed > 0 ? 'border-red-900/40' : 'border-zinc-800'}`}>
            <div className={`text-2xl font-bold ${ordFailed > 0 ? 'text-red-400' : 'text-zinc-400'}`}>{ordFailed}</div>
            <div className="text-xs text-zinc-500 mt-1">Помилок</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <div className="text-2xl font-bold text-zinc-300">
              {ordAvgDuration > 0 ? `${Math.round(ordAvgDuration / 1000)}с` : '—'}
            </div>
            <div className="text-xs text-zinc-500 mt-1">Середній час</div>
          </div>
        </div>

        {/* Orders log table */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="grid gap-4 px-6 py-3 border-b border-zinc-800 bg-zinc-800/50"
            style={{ gridTemplateColumns: '160px 100px 80px 100px 100px 80px 1fr' }}>
            <div className="text-xs text-zinc-500 uppercase tracking-wide">Час</div>
            <div className="text-xs text-zinc-500 uppercase tracking-wide">Тригер</div>
            <div className="text-xs text-zinc-500 uppercase tracking-wide">Статус</div>
            <div className="text-xs text-zinc-500 uppercase tracking-wide text-right">MauDau</div>
            <div className="text-xs text-zinc-500 uppercase tracking-wide text-right">Rozetka</div>
            <div className="text-xs text-zinc-500 uppercase tracking-wide text-right">Час</div>
            <div className="text-xs text-zinc-500 uppercase tracking-wide">Помилка</div>
          </div>
          <div className="divide-y divide-zinc-800">
            {orderEntries.length === 0 && (
              <div className="py-10 text-center text-zinc-600">
                Синків замовлень ще не було. Натисніть &quot;Синк замовлень&quot; щоб запустити.
              </div>
            )}
            {orderEntries.map(log => (
              <div key={log.id}
                className="grid gap-4 px-6 py-3.5 items-center hover:bg-zinc-800/20 transition-colors"
                style={{ gridTemplateColumns: '160px 100px 80px 100px 100px 80px 1fr' }}>
                <div>
                  <div className="text-xs text-zinc-300">{formatDate(log.created_at)}</div>
                  <div className="text-xs text-zinc-600 mt-0.5">{timeAgo(log.created_at)}</div>
                </div>
                <div>
                  {log.trigger === 'cron'
                    ? <span className="text-xs px-2 py-0.5 rounded-full bg-purple-950 text-purple-400">⏱ Авто</span>
                    : <div>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400">🖱 Вручну</span>
                        {log.triggered_by && <div className="text-xs text-zinc-500 mt-0.5 truncate max-w-[90px]" title={log.triggered_by}>{log.triggered_by}</div>}
                      </div>}
                </div>
                <div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${log.status === 'success' ? 'bg-emerald-950 text-emerald-400' : 'bg-red-950 text-red-400'}`}>
                    {log.status === 'success' ? '✓ OK' : '✕ Error'}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-sm font-semibold text-purple-400">{log.maudau_synced ?? 0}</span>
                  <span className="text-xs text-zinc-600 ml-1">шт</span>
                </div>
                <div className="text-right">
                  <span className="text-sm font-semibold text-pink-400">{log.rozetka_synced ?? 0}</span>
                  <span className="text-xs text-zinc-600 ml-1">шт</span>
                </div>
                <div className="text-right text-xs text-zinc-500">{log.duration_ms ? `${(log.duration_ms / 1000).toFixed(1)}с` : '—'}</div>
                <div className="text-xs text-red-400 truncate">{log.error ?? <span className="text-zinc-700">—</span>}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

    </div>
  )
}

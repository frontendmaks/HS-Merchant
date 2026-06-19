import { createServiceClient } from '@/lib/supabase/service'
import SyncTrigger from './SyncTrigger'

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
  const { data: logs } = await supabase
    .from('sync_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)

  const entries = logs ?? []
  const lastSuccess = entries.find(l => l.status === 'success')
  const totalSyncs = entries.length
  const failedSyncs = entries.filter(l => l.status === 'error').length
  const avgDuration = entries.filter(l => l.duration_ms).reduce((s, l, _, a) => s + l.duration_ms / a.length, 0)

  return (
    <div className="w-full space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Синхронізації</h1>
          <p className="text-zinc-500 text-sm mt-1">Журнал синків з WooCommerce</p>
        </div>
        <SyncTrigger />
      </div>

      {/* Cron schedule info */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="w-9 h-9 rounded-lg bg-blue-950 flex items-center justify-center text-blue-400 text-lg shrink-0">⏱</div>
          <div>
            <div className="text-sm font-medium text-white">Автоматичний розклад</div>
            <div className="text-xs text-zinc-500 mt-0.5">
              Vercel Cron запускає синк кожні 6 годин: <span className="font-mono text-zinc-400">0 */6 * * *</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-6 text-center shrink-0">
          <div>
            <div className="text-xs text-zinc-500">Розклад</div>
            <div className="text-sm text-blue-400 font-medium mt-0.5">Кожні 6 год</div>
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

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <div className="text-2xl font-bold text-white">{totalSyncs}</div>
          <div className="text-xs text-zinc-500 mt-1">Всього синків</div>
        </div>
        <div className="bg-zinc-900 border border-emerald-900/40 rounded-xl p-5">
          <div className="text-2xl font-bold text-emerald-400">
            {lastSuccess ? timeAgo(lastSuccess.created_at) : 'ніколи'}
          </div>
          <div className="text-xs text-zinc-500 mt-1">Останній успішний</div>
        </div>
        <div className={`bg-zinc-900 border rounded-xl p-5 ${failedSyncs > 0 ? 'border-red-900/40' : 'border-zinc-800'}`}>
          <div className={`text-2xl font-bold ${failedSyncs > 0 ? 'text-red-400' : 'text-zinc-400'}`}>{failedSyncs}</div>
          <div className="text-xs text-zinc-500 mt-1">Помилок</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <div className="text-2xl font-bold text-zinc-300">
            {avgDuration > 0 ? `${Math.round(avgDuration / 1000)}с` : '—'}
          </div>
          <div className="text-xs text-zinc-500 mt-1">Середній час</div>
        </div>
      </div>

      {/* Log table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="grid gap-4 px-6 py-3 border-b border-zinc-800 bg-zinc-800/50"
          style={{ gridTemplateColumns: '160px 80px 90px 90px 90px 90px 80px 1fr' }}>
          <div className="text-xs text-zinc-500 uppercase tracking-wide">Час</div>
          <div className="text-xs text-zinc-500 uppercase tracking-wide">Статус</div>
          <div className="text-xs text-zinc-500 uppercase tracking-wide text-right">Синкнуто</div>
          <div className="text-xs text-zinc-500 uppercase tracking-wide text-right">Деактив.</div>
          <div className="text-xs text-zinc-500 uppercase tracking-wide text-right">У WC</div>
          <div className="text-xs text-zinc-500 uppercase tracking-wide text-right">Зі складом</div>
          <div className="text-xs text-zinc-500 uppercase tracking-wide text-right">Час</div>
          <div className="text-xs text-zinc-500 uppercase tracking-wide">Помилка</div>
        </div>

        <div className="divide-y divide-zinc-800">
          {entries.length === 0 && (
            <div className="py-16 text-center text-zinc-600">
              Синків ще не було. Натисніть "Синк з WC" щоб запустити першу синхронізацію.
            </div>
          )}
          {entries.map(log => (
            <div key={log.id}
              className="grid gap-4 px-6 py-3.5 items-center hover:bg-zinc-800/20 transition-colors"
              style={{ gridTemplateColumns: '160px 80px 90px 90px 90px 90px 80px 1fr' }}>

              <div>
                <div className="text-xs text-zinc-300">{formatDate(log.created_at)}</div>
                <div className="text-xs text-zinc-600 mt-0.5">{timeAgo(log.created_at)}</div>
              </div>

              <div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  log.status === 'success'
                    ? 'bg-emerald-950 text-emerald-400'
                    : 'bg-red-950 text-red-400'
                }`}>
                  {log.status === 'success' ? '✓ OK' : '✕ Error'}
                </span>
              </div>

              <div className="text-right">
                <span className="text-sm font-semibold text-white">{log.synced}</span>
                <span className="text-xs text-zinc-600 ml-1">шт</span>
              </div>

              <div className="text-right">
                {log.deactivated > 0
                  ? <span className="text-sm font-semibold text-amber-400">{log.deactivated}</span>
                  : <span className="text-sm text-zinc-600">0</span>
                }
              </div>

              <div className="text-right text-sm text-zinc-400">{log.total_wc}</div>

              <div className="text-right text-sm text-zinc-400">{log.with_warehouse_stock}</div>

              <div className="text-right text-xs text-zinc-500">
                {log.duration_ms ? `${(log.duration_ms / 1000).toFixed(1)}с` : '—'}
              </div>

              <div className="text-xs text-red-400 truncate">
                {log.error ?? <span className="text-zinc-700">—</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

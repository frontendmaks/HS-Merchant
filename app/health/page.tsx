export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentRole, canAccess } from '@/lib/getRole'
import { cronHealth, orderChecks, recentFailures, type JobState } from '@/lib/system-health'

/**
 * Стан системи.
 *
 * Сторінка відповідає на одне питання — «що зараз не працює» — і мовчить,
 * коли все гаразд. Усе, що тут є, це або прохід, якого не було, або
 * замовлення, через яке завтра зателефонують.
 */

function ago(minutes: number | null) {
  if (minutes == null) return '—'
  if (minutes < 1) return 'щойно'
  if (minutes < 60) return `${minutes} хв тому`
  const h = Math.floor(minutes / 60)
  if (h < 24) return `${h} год тому`
  return `${Math.floor(h / 24)} д тому`
}

const every = (m: number) =>
  m === 0 ? 'за подією' : m < 60 ? `кожні ${m} хв` : m < 1440 ? 'щогодини' : 'раз на добу'

const TONE: Record<JobState['state'], { dot: string; text: string; label: string }> = {
  ok: { dot: 'bg-emerald-500', text: 'text-emerald-500', label: 'працює' },
  late: { dot: 'bg-amber-500', text: 'text-amber-500', label: 'спізнюється' },
  failing: { dot: 'bg-red-500', text: 'text-red-400', label: 'з помилкою' },
  silent: { dot: 'bg-zinc-600', text: 'text-zinc-500', label: 'немає записів за добу' },
}

export default async function HealthPage() {
  const role = await getCurrentRole()
  if (!canAccess('health', role)) redirect('/orders')

  const service = createServiceClient()
  const [jobs, checks, failures] = await Promise.all([
    cronHealth(service),
    orderChecks(service),
    recentFailures(service),
  ])

  const broken = jobs.filter(j => j.state !== 'ok')
  const working = jobs.filter(j => j.state === 'ok')
  const bad = checks.filter(c => c.severity === 'bad')
  const warn = checks.filter(c => c.severity === 'warn')
  const allWell = !broken.length && !checks.length

  return (
    <div className="p-4 lg:p-8 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl lg:text-2xl font-semibold text-white">Стан системи</h1>
        <p className="text-zinc-500 text-sm mt-1">
          Що працює саме зараз і що треба полагодити. Порожньо — значить, усе гаразд.
        </p>
      </div>

      {allWell && (
        <div className="bg-emerald-950/40 border border-emerald-900 rounded-xl p-5 mb-6">
          <div className="text-emerald-400 font-medium">Усе працює</div>
          <div className="text-zinc-400 text-sm mt-1">
            Усі {jobs.length} розкладів ходять за часом, застряглих замовлень немає.
          </div>
        </div>
      )}

      {/* Замовлення — перші: розклад можна полагодити завтра, а замовлення
          везуть сьогодні */}
      {!!checks.length && (
        <section className="mb-8">
          <h2 className="text-white font-medium mb-3">Замовлення, які застрягли</h2>
          <div className="space-y-2">
            {[...bad, ...warn].map(c => (
              <Link
                key={c.key}
                href={c.href}
                className={`block rounded-xl border p-4 transition-colors ${
                  c.severity === 'bad'
                    ? 'bg-red-950/30 border-red-900/70 hover:border-red-700'
                    : 'bg-amber-950/20 border-amber-900/60 hover:border-amber-700'
                }`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-white text-sm font-medium">{c.label}</span>
                  <span className={`text-lg font-semibold shrink-0 ${
                    c.severity === 'bad' ? 'text-red-400' : 'text-amber-500'
                  }`}>{c.count}</span>
                </div>
                <div className="text-zinc-400 text-xs mt-1">{c.why}</div>
                {!!c.sample.length && (
                  <div className="text-zinc-500 text-xs mt-1.5">
                    {c.sample.join(', ')}{c.count > c.sample.length ? ' …' : ''}
                  </div>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="mb-8">
        <h2 className="text-white font-medium mb-3">Розклади</h2>

        {/* Добовий розклад, який щойно навчили звітувати, перший день
            виглядатиме як «немає записів»: це правда, і вона мине сама */}
        {!!broken.length && (
          <div className="space-y-2 mb-3">
            {broken.map(j => (
              <div key={j.name}
                className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${TONE[j.state].dot}`} />
                  <span className="text-white text-sm font-medium">{j.label}</span>
                  <span className={`text-xs ${TONE[j.state].text}`}>{TONE[j.state].label}</span>
                  <span className="text-zinc-600 text-xs ml-auto">
                    {every(j.everyMinutes)} · востаннє {ago(j.agoMinutes)}
                  </span>
                </div>
                <div className="text-zinc-400 text-xs mt-1.5">Поки не працює: {j.costs}</div>
                {j.error && (
                  <div className="text-red-400 text-xs mt-1.5 break-words font-mono">
                    {j.error}
                  </div>
                )}
                {j.failed24h > 0 && (
                  <div className="text-zinc-500 text-xs mt-1">
                    невдалих за добу: {j.failed24h} з {j.runs24h}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Робочі — одним щільним списком: їх більшість, і читають їх
            лише щоб переконатись, що розклад узагалі є */}
        {!!working.length && (
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl divide-y divide-zinc-800/70">
            {working.map(j => (
              <div key={j.name} className="flex items-center gap-2 px-4 py-2 text-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                <span className="text-zinc-300 truncate">{j.label}</span>
                <span className="text-zinc-600 ml-auto shrink-0 whitespace-nowrap">
                  {ago(j.agoMinutes)}
                  {j.durationMs != null && ` · ${(j.durationMs / 1000).toFixed(1)} с`}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {!!failures.length && (
        <section>
          <h2 className="text-white font-medium mb-3">Помилки за добу</h2>
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl divide-y divide-zinc-800/70">
            {failures.map((f, i) => (
              <div key={i} className="px-4 py-2.5 text-xs">
                <div className="flex items-baseline gap-2">
                  <span className="text-zinc-400">{f.name}</span>
                  <span className="text-zinc-600">
                    {new Date(f.ran_at).toLocaleString('uk-UA', {
                      day: '2-digit', month: '2-digit',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                </div>
                <div className="text-red-400 mt-1 break-words font-mono">{f.error}</div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

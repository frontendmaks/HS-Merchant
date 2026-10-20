'use client'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useTransition } from 'react'
import { useOrderUpdatesThrottled } from '@/lib/use-order-updates'

export interface FunnelTab { key: string; label: string; count: number }

/**
 * Фільтри вкладки «Сайт».
 *
 * День і стадія — два питання, які оператор ставить собі щоразу: «що
 * сьогодні» і «що з цим робити». Дата за замовчуванням сьогоднішня, бо саме
 * сьогоднішні замовлення возять; інші дні відкриваються, коли по них
 * питають.
 */
export default function SiteFilters({ date, stage, tabs }: {
  date: string
  stage: string
  tabs: FunnelTab[]
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [, start] = useTransition()

  // Зміна в будь-якому замовленні — привід перечитати список: оператор
  // дивиться в екран і не має натискати оновлення, щоб побачити нове.
  // Але не на кожне з сотні повідомлень одного проходу — після затишшя
  useOrderUpdatesThrottled(() => start(() => router.refresh()))

  function go(next: Record<string, string>) {
    const q = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(next)) {
      if (v) q.set(k, v); else q.delete(k)
    }
    router.push(`/orders/site?${q}`)
  }

  const shift = (days: number) => {
    const d = new Date(`${date}T12:00:00`)
    d.setDate(d.getDate() + days)
    go({ date: d.toISOString().slice(0, 10) })
  }

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Kyiv' })

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1">
        <button onClick={() => shift(-1)}
          className="px-2 py-1 text-zinc-400 hover:text-white text-sm transition-colors">‹</button>
        <input
          type="date" value={date}
          onChange={e => go({ date: e.target.value })}
          className="bg-transparent text-white text-xs px-1 focus:outline-none"
        />
        <button onClick={() => shift(1)}
          className="px-2 py-1 text-zinc-400 hover:text-white text-sm transition-colors">›</button>
        {date !== today && (
          <button onClick={() => go({ date: today })}
            className="px-2 py-1 text-zinc-400 hover:text-white text-xs transition-colors">
            сьогодні
          </button>
        )}
      </div>

      <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1
                      flex-wrap">
        {tabs.map(t => {
          // Нулі приглушені, решта помітна: число на вкладці — це робота,
          // яка там чекає, і її не має доводитись видивлятись
          const empty = t.count === 0
          const urgent = t.key === 'problem' || t.key === 'new'

          return (
            <button key={t.key} onClick={() => go({ stage: t.key })}
              className={`px-3 py-1.5 rounded-lg text-xs transition-colors whitespace-nowrap
                          flex items-center gap-1.5 ${
                stage === t.key ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'
              }`}>
              <span>{t.label}</span>
              <span className={`px-1.5 py-0.5 rounded text-[11px] font-semibold tabular-nums ${
                empty ? 'bg-zinc-800 text-zinc-600'
                  : urgent ? 'bg-red-600 text-white'
                  : 'bg-zinc-600 text-white'
              }`}>
                {t.count}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

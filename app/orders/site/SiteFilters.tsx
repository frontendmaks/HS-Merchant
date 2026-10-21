'use client'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRef, useTransition } from 'react'
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
export default function SiteFilters({
  date, stage, tabs, warehouses, slots, picked, total,
}: {
  date: string
  stage: string
  tabs: FunnelTab[]
  /** Склади й періоди, які цього дня справді трапляються */
  warehouses: string[]
  slots: string[]
  picked: { wh: string; slot: string; src: string; q: string }
  /** Скільки всього замовлень цього дня — щоб було видно, що зріз вужчий */
  total: number
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [, start] = useTransition()
  const typing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

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

  const narrowed = !!(picked.wh || picked.slot || picked.src || picked.q)
  const field = 'bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-white text-xs focus:outline-none focus:border-red-500'

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

      <div className="flex flex-wrap items-center gap-2 w-full">
        <input
          type="search"
          defaultValue={picked.q}
          placeholder="Клієнт, телефон, адреса, номер"
          onChange={e => {
            const value = e.target.value
            // Чекаємо, поки людина допише: запит на кожну літеру змушував
            // би сторінку перечитуватись швидше, ніж вона встигає
            clearTimeout(typing.current)
            typing.current = setTimeout(() => go({ q: value }), 350)
          }}
          className={`${field} min-w-[220px] flex-1 max-w-xs`}
        />

        <select value={picked.wh} onChange={e => go({ wh: e.target.value })} className={field}>
          <option value="">Усі склади</option>
          {warehouses.map(w => <option key={w} value={w}>{w}</option>)}
        </select>

        <select value={picked.slot} onChange={e => go({ slot: e.target.value })} className={field}>
          <option value="">Будь-який період</option>
          {slots.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <select value={picked.src} onChange={e => go({ src: e.target.value })} className={field}>
          <option value="">Сайт і телефон</option>
          <option value="site">Лише сайт</option>
          <option value="manual">Лише телефон</option>
        </select>

        {narrowed && (
          <button
            onClick={() => go({ wh: '', slot: '', src: '', q: '' })}
            className="px-2.5 py-1.5 rounded-lg text-xs bg-zinc-800 text-zinc-400
                       hover:text-white transition-colors"
          >
            Скинути · з {total}
          </button>
        )}
      </div>
    </div>
  )
}

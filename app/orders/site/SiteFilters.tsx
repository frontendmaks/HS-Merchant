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
  monthly, monthLabel, forcedBySearch,
}: {
  date: string
  stage: string
  tabs: FunnelTab[]
  /** Склади й періоди, які цього дня справді трапляються */
  warehouses: string[]
  slots: string[]
  picked: { wh: string; slot: string; src: string; q: string }
  /** Скільки всього замовлень у зрізі — щоб було видно, що фільтр вужчий */
  total: number
  /** Чи дивимось цілий місяць замість одного дня */
  monthly: boolean
  /** «жовтень 2026» — підпис обраного місяця */
  monthLabel: string
  /** Місяць увімкнувся сам, бо шукають: про це варто сказати вголос */
  forcedBySearch: boolean
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [pending, start] = useTransition()
  const typing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Зміна в будь-якому замовленні — привід перечитати список: оператор
  // дивиться в екран і не має натискати оновлення, щоб побачити нове.
  // Але не на кожне з сотні повідомлень одного проходу — після затишшя
  useOrderUpdatesThrottled(() => start(() => router.refresh()))

  /*
   * Перехід — через перехід, а не просто push.
   *
   * Сторінка читає базу на сервері, і доки відповідь іде, екран лишається
   * старим: натиснув «Місяць» — і нічого не відбувається, аж поки все не
   * з'явиться. Схоже на те, що натискання не зарахувалось, і його
   * повторюють.
   *
   * `useTransition` дає те, чого бракувало: ознаку, що відповідь у дорозі.
   * Старі дані при цьому лишаються на екрані — з ними можна працювати, —
   * але видно, що вони вже не остаточні.
   */
  function go(next: Record<string, string>) {
    const q = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(next)) {
      if (v) q.set(k, v); else q.delete(k)
    }
    start(() => router.push(`/orders/site?${q}`))
  }

  const shift = (days: number) => {
    const d = new Date(`${date}T12:00:00`)
    d.setDate(d.getDate() + days)
    go({ date: d.toISOString().slice(0, 10) })
  }

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Kyiv' })

  const narrowed = !!(picked.wh || picked.slot || picked.src || picked.q)
  /*
   * Висота сорок чотири — тільки на телефоні.
   *
   * Пальцем цілять у смужку заввишки тридцять сім пікселів і
   * промахуються; мишею — ні, і на широкому екрані висока смужка
   * фільтрів лише забирає місце в списку. Тому `lg:h-auto`.
   */
  const field = 'bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-white text-xs h-11 lg:h-auto focus:outline-none focus:border-red-500'

  return (
    <div className={`flex flex-wrap items-center gap-2 relative transition-opacity ${
      pending ? 'opacity-60' : ''
    }`}>
      {/* Смужка поверх фільтрів: вона й каже, що відповідь у дорозі */}
      {pending && (
        <span className="absolute -top-1 left-0 right-0 h-0.5 overflow-hidden rounded-full">
          <span className="block h-full w-1/3 bg-red-500 animate-[slide_1s_ease-in-out_infinite]" />
        </span>
      )}
      <style>{'@keyframes slide{0%{margin-left:0}50%{margin-left:66%}100%{margin-left:0}}'}</style>
      {/* День чи місяць. За день працюють, за місяць питають: «скільки
          возили» і «коли був цей клієнт» — на це день не відповідає */}
      <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1">
        {([['', 'День'], ['month', 'Місяць']] as const).map(([value, label]) => (
          <button key={label} onClick={() => go({ period: value })}
            className={`px-3 h-11 lg:h-auto lg:py-1.5 rounded-lg text-xs transition-colors
                        whitespace-nowrap ${
              (value === 'month') === monthly ? 'bg-zinc-700 text-white'
                : 'text-zinc-400 hover:text-white'
            }`}>
            {label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1">
        <button onClick={() => shift(-1)}
          className="w-11 h-11 lg:w-auto lg:h-auto lg:px-2 lg:py-1 text-zinc-400 hover:text-white
                     text-sm transition-colors">‹</button>
        <input
          type="date" value={date}
          onChange={e => go({ date: e.target.value })}
          className="bg-transparent text-white text-xs px-1 h-11 lg:h-auto focus:outline-none"
        />
        <button onClick={() => shift(1)}
          className="w-11 h-11 lg:w-auto lg:h-auto lg:px-2 lg:py-1 text-zinc-400 hover:text-white
                     text-sm transition-colors">›</button>
        {monthly && <span className="px-1.5 text-zinc-500 text-xs">{monthLabel}</span>}
        {date !== today && (
          <button onClick={() => go({ date: today })}
            className="px-2 h-11 lg:h-auto lg:py-1 text-zinc-400 hover:text-white text-xs
                       transition-colors">
            сьогодні
          </button>
        )}
      </div>

      {/* На телефоні вкладки їдуть однією смужкою вбік: вісім стадій,
          поставлені в стовпчик, з'їдали б пів екрана до того, як видно
          перше замовлення */}
      <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1
                      overflow-x-auto max-w-full sm:flex-wrap">
        {tabs.map(t => {
          // Нулі приглушені, решта помітна: число на вкладці — це робота,
          // яка там чекає, і її не має доводитись видивлятись
          const empty = t.count === 0
          const urgent = t.key === 'problem' || t.key === 'new'

          return (
            <button key={t.key} onClick={() => go({ stage: t.key })}
              className={`px-3 h-11 lg:h-auto lg:py-1.5 rounded-lg text-xs transition-colors
                          whitespace-nowrap flex items-center gap-1.5 ${
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
          placeholder="Клієнт, телефон, адреса, номер — за весь місяць"
          onChange={e => {
            const value = e.target.value
            // Чекаємо, поки людина допише: запит на кожну літеру змушував
            // би сторінку перечитуватись швидше, ніж вона встигає
            clearTimeout(typing.current)
            typing.current = setTimeout(() => go({ q: value }), 350)
          }}
          className={`${field} w-full sm:w-auto sm:min-w-[220px] sm:flex-1 sm:max-w-xs`}
        />

        <select value={picked.wh} onChange={e => go({ wh: e.target.value })}
          className={`${field} flex-1 sm:flex-none min-w-0`}>
          <option value="">Усі склади</option>
          {warehouses.map(w => <option key={w} value={w}>{w}</option>)}
        </select>

        <select value={picked.slot} onChange={e => go({ slot: e.target.value })}
          className={`${field} flex-1 sm:flex-none min-w-0`}>
          <option value="">Будь-який період</option>
          {slots.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <select value={picked.src} onChange={e => go({ src: e.target.value })}
          className={`${field} flex-1 sm:flex-none min-w-0`}>
          <option value="">Сайт і телефон</option>
          <option value="site">Лише сайт</option>
          <option value="manual">Лише телефон</option>
        </select>

        {forcedBySearch && (
          <span className="text-zinc-500 text-xs">
            шукаємо за {monthLabel}
          </span>
        )}

        {pending && (
          <span className="text-zinc-400 text-xs">оновлюю…</span>
        )}

        {narrowed && (
          <button
            onClick={() => go({ wh: '', slot: '', src: '', q: '' })}
            className="px-2.5 h-11 lg:h-auto lg:py-1.5 rounded-lg text-xs bg-zinc-800 text-zinc-400
                       hover:text-white transition-colors"
          >
            Скинути · з {total}
          </button>
        )}
      </div>
    </div>
  )
}

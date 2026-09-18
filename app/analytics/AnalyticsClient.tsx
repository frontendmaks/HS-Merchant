'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import UkraineMap from './UkraineMap'
import type {
  Totals, DayBucket, ProductStat, CategoryStat, CustomerStat, RegionStat,
} from '@/lib/analytics'

import type { OperatorStat, CancelStats, CancelSide } from '@/lib/analytics'
import { CANCEL_SIDE_LABEL } from '@/lib/analytics'
import { money, moneyShort, pct, num, dayMonth, orderWord } from '@/lib/format'

function Card({ label, value, sub, tone = 'white' }: {
  label: string
  value: string
  sub?: string
  tone?: 'white' | 'emerald' | 'red' | 'amber' | 'cyan'
}) {
  const colors = {
    white: 'text-white', emerald: 'text-emerald-400', red: 'text-red-400',
    amber: 'text-amber-400', cyan: 'text-cyan-400',
  }
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <div className="text-zinc-400 text-xs font-medium uppercase tracking-wide mb-1">{label}</div>
      <div className={`text-2xl font-bold ${colors[tone]}`}>{value}</div>
      {sub && <div className="text-zinc-500 text-xs mt-0.5">{sub}</div>}
    </div>
  )
}

function Panel({ title, subtitle, children, right }: {
  title: string
  subtitle?: string
  children: React.ReactNode
  right?: React.ReactNode
}) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-zinc-800 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-white font-semibold text-sm">{title}</h2>
          {subtitle && <p className="text-zinc-500 text-xs mt-0.5">{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </div>
  )
}

type ChartMetric = 'count' | 'ordered'

/** Bar chart of orders per day, drawn with plain divs. */
function DailyChart({ data, metric }: { data: DayBucket[]; metric: ChartMetric }) {
  if (!data.length) {
    return <div className="px-5 py-10 text-center text-zinc-600 text-sm">Немає даних</div>
  }
  const valueOf = (d: DayBucket) => metric === 'count' ? d.count : d.ordered
  const max = Math.max(...data.map(valueOf), metric === 'count' ? 1 : 0)

  // Averages ignore empty days — "4.9 per day" should not be diluted by
  // stretches with no orders at all.
  const active = data.filter(d => d.count > 0)
  const avg = active.length
    ? active.reduce((s, d) => s + valueOf(d), 0) / active.length
    : 0

  const fmtValue = (v: number) => metric === 'count' ? String(v) : moneyShort(v)

  return (
    <div className="p-5">
      <div className="flex items-end gap-[3px] h-44">
        {data.map(d => {
          const v = valueOf(d)
          const h = max ? (v / max) * 100 : 0
          const empty = d.count === 0
          return (
            <div
              key={d.date}
              className="flex-1 min-w-[3px] max-w-[26px] h-full flex flex-col justify-end relative group"
            >
              <div
                className={`w-full rounded-t-sm transition-colors ${
                  empty
                    ? 'bg-zinc-800 group-hover:bg-zinc-700'
                    : 'bg-red-600/80 group-hover:bg-red-500'
                }`}
                style={{ height: empty ? '2px' : `${Math.max(h, 3)}%` }}
              />
              <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-10 whitespace-nowrap bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs shadow-xl">
                <div className="text-white font-medium">{dayMonth(d.date)}</div>
                {empty ? (
                  <div className="text-zinc-500">без замовлень</div>
                ) : (
                  <>
                    <div className="text-zinc-300">{d.count} {orderWord(d.count)}</div>
                    <div className="text-zinc-400">замовили на {moneyShort(d.ordered)}</div>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-y-2 mt-3 text-xs text-zinc-500">
        <span>{dayMonth(data[0].date)}</span>
        <span className="text-zinc-400">
          У середньому{' '}
          <span className="text-white font-medium">
            {metric === 'count' ? avg.toFixed(1) : moneyShort(avg)}
          </span>
          {' за день із замовленнями · пік '}
          <span className="text-white font-medium">{fmtValue(max)}</span>
        </span>
        <span>{dayMonth(data[data.length - 1].date)}</span>
      </div>
    </div>
  )
}

function RankedList({ rows, valueOf, labelOf, metaOf, max }: {
  rows: unknown[]
  labelOf: (r: never) => string
  valueOf: (r: never) => number
  metaOf: (r: never) => string
  max: number
}) {
  if (!rows.length) {
    return <div className="px-5 py-10 text-center text-zinc-600 text-sm">Немає даних</div>
  }
  return (
    <div className="divide-y divide-zinc-800/60">
      {rows.map((r, i) => {
        const value = valueOf(r as never)
        return (
          <div key={i} className="px-5 py-2.5">
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <span className="text-zinc-200 text-xs truncate">{labelOf(r as never)}</span>
              <span className="text-zinc-400 text-xs whitespace-nowrap">{metaOf(r as never)}</span>
            </div>
            <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-red-600/70 rounded-full"
                style={{ width: `${max ? (value / max) * 100 : 0}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Local date parts — toISOString() would shift midnight back a day in UTC+N
/** 95 -> "1 год 35 хв" */
function duration(mins: number): string {
  if (mins < 60) return `${mins} хв`
  const h = Math.floor(mins / 60), m = mins % 60
  if (h < 24) return m ? `${h} год ${m} хв` : `${h} год`
  const d = Math.floor(h / 24)
  return `${d} дн ${h % 24} год`
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const monthLabel = (from: string) => {
  const MONTHS = ['Січень','Лютий','Березень','Квітень','Травень','Червень',
                  'Липень','Серпень','Вересень','Жовтень','Листопад','Грудень']
  const [y, m] = from.split('-').map(Number)
  return `${MONTHS[m - 1]} ${y}`
}

/** Whole calendar month containing `anchor`, shifted by `offset` months. */
function monthRange(anchor: string, offset = 0) {
  const [y, m] = anchor.split('-').map(Number)
  const first = new Date(y, m - 1 + offset, 1)
  const last = new Date(y, m + offset, 0)
  return { from: iso(first), to: iso(last) }
}

function PeriodPicker({ from, to, onChange, pending }: {
  from: string
  to: string
  onChange: (from: string, to: string) => void
  pending?: boolean
}) {
  const openPicker = (el: HTMLInputElement) => {
    try { el.showPicker?.() } catch { /* needs a user gesture */ }
  }
  const thisMonth = monthRange(iso(new Date()))
  const isWholeMonth = (() => {
    const r = monthRange(from)
    return r.from === from && r.to === to
  })()

  const field = 'bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-white text-xs focus:outline-none focus:border-red-500 cursor-pointer'

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {isWholeMonth && (
        <div className="flex items-center gap-1">
          <button
            onClick={() => { const r = monthRange(from, -1); onChange(r.from, r.to) }}
            title="Попередній місяць"
            className="px-2 py-1.5 rounded-lg text-xs bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
          >
            ‹
          </button>
          <span className={`text-xs min-w-[110px] text-center transition-colors ${
            pending ? 'text-zinc-500' : 'text-zinc-300'
          }`}>
            {monthLabel(from)}
          </span>
          <button
            onClick={() => { const r = monthRange(from, 1); onChange(r.from, r.to) }}
            disabled={from >= thisMonth.from}
            title="Наступний місяць"
            className="px-2 py-1.5 rounded-lg text-xs bg-zinc-800 text-zinc-400 hover:text-white disabled:opacity-30 transition-colors"
          >
            ›
          </button>
        </div>
      )}

      <input
        type="date" value={from} max={to} className={field}
        onChange={e => onChange(e.target.value, to)}
        onClick={e => openPicker(e.currentTarget)}
        onFocus={e => openPicker(e.currentTarget)}
      />
      <span className="text-zinc-600 text-xs">—</span>
      <input
        type="date" value={to} min={from} className={field}
        onChange={e => onChange(from, e.target.value)}
        onClick={e => openPicker(e.currentTarget)}
        onFocus={e => openPicker(e.currentTarget)}
      />

      <button
        onClick={() => onChange(thisMonth.from, thisMonth.to)}
        className="px-2.5 py-1.5 rounded-lg text-xs bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
      >
        Цей місяць
      </button>
    </div>
  )
}

type CustomerSort = 'name' | 'address' | 'orders' | 'delivered' | 'revenue' | 'cadenceDays'

function CustomersTable({ rows }: { rows: CustomerStat[] }) {
  const [sort, setSort] = useState<CustomerSort>('revenue')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')

  const toggle = (key: CustomerSort) => {
    if (key === sort) { setDir(d => d === 'asc' ? 'desc' : 'asc'); return }
    setSort(key)
    // Text reads naturally A→Z; numbers are most useful biggest-first
    setDir(key === 'name' || key === 'address' ? 'asc' : 'desc')
  }

  const sorted = [...rows].sort((a, b) => {
    const mul = dir === 'asc' ? 1 : -1
    const av = a[sort], bv = b[sort]
    if (av == null && bv == null) return 0
    if (av == null) return 1          // blanks always last
    if (bv == null) return -1
    return typeof av === 'string' && typeof bv === 'string'
      ? mul * av.localeCompare(bv, 'uk')
      : mul * (Number(av) - Number(bv))
  })

  const COLUMNS: { key: CustomerSort; label: string; align: 'left' | 'right' }[] = [
    { key: 'name', label: 'Клієнт', align: 'left' },
    { key: 'address', label: 'Адреса', align: 'left' },
    { key: 'orders', label: 'Замовлень', align: 'right' },
    { key: 'delivered', label: 'Доставлено', align: 'right' },
    { key: 'revenue', label: 'LTV', align: 'right' },
    { key: 'cadenceDays', label: 'Періодичність', align: 'right' },
  ]

  return (
    <Panel title="Топ клієнтів за LTV" subtitle="Натисніть на заголовок, щоб відсортувати">
      {sorted.length === 0 ? (
        <div className="px-5 py-10 text-center text-zinc-600 text-sm">Немає даних</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500 text-xs">
                {COLUMNS.map((c, i) => (
                  <th
                    key={c.key}
                    onClick={() => toggle(c.key)}
                    className={`px-5 py-2.5 cursor-pointer select-none hover:text-zinc-300 transition-colors ${
                      c.align === 'right' ? 'text-right' : 'text-left'
                    } ${i > 1 ? 'whitespace-nowrap' : ''}`}
                  >
                    {c.label}
                    <span className={sort === c.key ? 'text-red-400' : 'text-zinc-700'}>
                      {' '}{sort === c.key ? (dir === 'asc' ? '▲' : '▼') : '⇅'}
                    </span>
                  </th>
                ))}
                <th className="text-left px-5 py-2.5 whitespace-nowrap">Телефон</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {sorted.map(c => (
                <tr key={c.key} className="hover:bg-zinc-800/30 transition-colors">
                  <td className="px-5 py-2.5 text-white text-xs">{c.name}</td>
                  <td className="px-5 py-2.5 text-zinc-400 text-xs max-w-[280px] truncate" title={c.address ?? ''}>
                    {c.address ?? '—'}
                  </td>
                  <td className="px-5 py-2.5 text-right text-zinc-300 text-xs">{c.orders}</td>
                  <td className="px-5 py-2.5 text-right text-emerald-400 text-xs">{c.delivered}</td>
                  <td className="px-5 py-2.5 text-right text-white text-xs whitespace-nowrap">{moneyShort(c.revenue)}</td>
                  <td className="px-5 py-2.5 text-right text-zinc-400 text-xs whitespace-nowrap">
                    {c.cadenceDays != null ? `~${c.cadenceDays} дн.` : '—'}
                  </td>
                  <td className="px-5 py-2.5 text-zinc-400 text-xs whitespace-nowrap">{c.phone ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

/** Who ended the order, and what it cost. */
function Cancellations({ c }: { c: CancelStats }) {
  const sides: CancelSide[] = ['guest', 'us', 'unknown']
  const fill: Record<CancelSide, string> = {
    guest: 'bg-amber-500/70',
    us: 'bg-red-600/70',
    unknown: 'bg-zinc-600/70',
  }
  const text: Record<CancelSide, string> = {
    guest: 'text-amber-400',
    us: 'text-red-400',
    unknown: 'text-zinc-400',
  }

  if (!c.total) {
    return (
      <Panel title="Скасування" subtitle="Хто скасував і чому">
        <div className="px-5 py-10 text-center text-zinc-600 text-sm">
          За цей період скасувань немає
        </div>
      </Panel>
    )
  }

  const known = c.total - c.bySide.unknown.orders
  const max = Math.max(1, ...c.reasons.map(r => r.orders))
  // Reasons live under the side that caused them. The same wording can belong
  // to two sides — "Причину не вказано" is ours when the journal names an
  // operator and unknown when nothing does — and a flat list had to repeat it
  // with a suffix to stay truthful. A heading says it once instead.
  const groups = sides
    .map(side => ({ side, rows: c.reasons.filter(r => r.side === side) }))
    .filter(g => g.rows.length > 0)

  return (
    <Panel
      title="Скасування"
      subtitle={`${num(c.total)} ${orderWord(c.total)} · ${moneyShort(c.lost)} не отримано`}
    >
      <div className="px-5 py-4 border-b border-zinc-800/60">
        {/* One bar: the split reads faster than three numbers side by side */}
        <div className="flex h-2 rounded-full overflow-hidden mb-4">
          {sides.map(side => {
            const share = c.bySide[side].orders / c.total
            if (!share) return null
            return (
              <div
                key={side}
                className={fill[side]}
                style={{ width: `${share * 100}%` }}
                title={`${CANCEL_SIDE_LABEL[side]} — ${c.bySide[side].orders}`}
              />
            )
          })}
        </div>

        <div className="grid grid-cols-3 gap-4">
          {sides.map(side => (
            <div key={side}>
              <div className={`text-xs ${text[side]}`}>{CANCEL_SIDE_LABEL[side]}</div>
              <div className="text-white text-lg font-semibold leading-tight mt-0.5">
                {num(c.bySide[side].orders)}
                <span className="text-zinc-500 text-xs font-normal ml-1.5">
                  {pct(c.bySide[side].orders, c.total)}
                </span>
              </div>
              <div className="text-zinc-500 text-xs mt-0.5">
                {moneyShort(c.bySide[side].lost)}
              </div>
            </div>
          ))}
        </div>

        {/* The unknown share is stated, not quietly folded into the other two —
            a split that hides how much of it is guesswork is worse than none */}
        {c.bySide.unknown.orders > 0 && (
          <p className="text-zinc-500 text-xs mt-4 leading-relaxed">
            Сторону не встановлено для {num(c.bySide.unknown.orders)} із {num(c.total)}
            {known > 0 && `, решта ${num(known)} визначена`}.
            {c.beforeJournal > 0 && ` ${num(c.beforeJournal)} скасовано до появи журналу змін — читати там нічого.`}
            {c.unexplained > 0 && ` ${num(c.unexplained)} скасовано поза панеллю і без причини: MauDau своєї не повертає.`}
          </p>
        )}
      </div>

      {c.noReason.orders > 0 && (
        <div className="px-5 py-3 border-b border-zinc-800/60 flex items-baseline
                        justify-between gap-3">
          <span className="text-zinc-300 text-xs">
            Причину не вказано
            {/* Which side it fell on is still known for some of these, but it
                is an aside here — the same words on two rows read as two
                different things, and they are not */}
            <span className="text-zinc-600">
              {' · '}
              {(['us', 'guest', 'unknown'] as CancelSide[])
                .filter(side => c.noReason.bySide[side] > 0)
                .map(side => `${CANCEL_SIDE_LABEL[side].toLowerCase()} ${c.noReason.bySide[side]}`)
                .join(', ')}
            </span>
          </span>
          <span className="text-zinc-400 text-xs whitespace-nowrap">
            {num(c.noReason.orders)} · {moneyShort(c.noReason.lost)}
          </span>
        </div>
      )}

      {groups.map(g => (
        <div key={g.side}>
          <div className="px-5 py-2 bg-zinc-800/30 border-b border-zinc-800/60
                          flex items-baseline justify-between gap-3">
            <span className={`text-xs font-medium ${text[g.side]}`}>
              {CANCEL_SIDE_LABEL[g.side]}
            </span>
            <span className="text-zinc-500 text-xs whitespace-nowrap">
              {num(g.rows.reduce((n, r) => n + r.orders, 0))}
              {' · '}
              {moneyShort(g.rows.reduce((n, r) => n + r.lost, 0))}
            </span>
          </div>
          <div className="divide-y divide-zinc-800/60">
            {g.rows.map(r => (
              <div key={r.reason} className="px-5 py-2.5">
                <div className="flex items-baseline justify-between gap-3 mb-1">
                  {/* MauDau prefixes its reasons by category. Under the
                      "Гість" heading that prefix just says it twice; the
                      others — Оплата, Наявність товару — still carry meaning */}
                  <span className="text-zinc-200 text-xs truncate" title={r.reason}>
                    {r.side === 'guest' ? r.reason.replace(/^Гість\s*:\s*/i, '') : r.reason}
                  </span>
                  <span className="text-zinc-400 text-xs whitespace-nowrap">
                    {num(r.orders)} · {moneyShort(r.lost)}
                  </span>
                </div>
                <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${fill[r.side]}`}
                    style={{ width: `${(r.orders / max) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </Panel>
  )
}

/** Side-by-side comparison of operators on one measure. */
function OperatorBars({ title, rows, format, lowerIsBetter }: {
  title: string
  rows: { name: string; value: number }[]
  format: (v: number) => string
  lowerIsBetter?: boolean
}) {
  if (!rows.length) return null
  const max = Math.max(...rows.map(r => r.value), 1)
  const best = lowerIsBetter
    ? Math.min(...rows.map(r => r.value))
    : Math.max(...rows.map(r => r.value))

  return (
    <div>
      <div className="text-zinc-400 text-xs mb-2.5">{title}</div>
      <div className="space-y-2">
        {rows.map(r => (
          <div key={r.name} className="flex items-center gap-3">
            <div className="w-32 shrink-0 text-zinc-300 text-xs truncate">{r.name}</div>
            <div className="flex-1 h-5 bg-zinc-800/60 rounded overflow-hidden">
              <div
                className={`h-full rounded transition-all ${
                  r.value === best ? 'bg-emerald-600/70' : 'bg-red-600/60'
                }`}
                style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }}
              />
            </div>
            <div className="w-20 shrink-0 text-right text-zinc-400 text-xs">{format(r.value)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** What each column of the operator table actually measures. Written out
 *  because half of them are ratios whose denominator is not obvious. */
const METRIC_HELP: [string, string][] = [
  ['Замовлень', 'скільки різних замовлень оператор торкався хоча б раз'],
  ['Дій', 'усі записи в журналі замовлень: зміни статусу, правки позицій, ТТН, скасування'],
  ['ТТН', 'скільки накладних Нової Пошти створено'],
  ['Сума', 'сумарна вартість замовлень, які він вів'],
  ['Серед. чек', 'ця сума, поділена на кількість замовлень'],
  ['Доставлено', 'скільки з його замовлень дійшли до покупця, і яка це частка'],
  ['Скасовано', 'скільки скасовано, і яка це частка — причина може бути й не в операторі'],
  ['Реакція', 'скільки замовлення чекало на оператора: від його надходження до статусу «Прийнято» (в Rozetka — «Опрацьовується»). Час поза зміною не рахується, тож нічне очікування не приписується нікому'],
  ['Опрацювання', 'скільки зайняла сама робота: від прийняття замовлення до моменту, коли його передали в доставку. Порожньо, поки оператор не провів замовлення через обидва статуси'],
  ['Присутність', 'скільки з уже відпрацьованих годин панель справді була відкрита. Зміни до 26.08.2026 не вимірювались, тож у них присутності немає'],
  ['Просувань/год', 'головний показник: скільки разів на годину зміни оператор просунув замовлення далі — Нове → Прийнято → Узгоджено → На доставці (в Rozetka: Опрацьовується → Комплектується → Передано в доставку). Друге число — усього просувань за період'],
]

const MARKETPLACES = [
  { key: 'all', label: 'Загальна' },
  { key: 'maudau', label: 'MauDau' },
  { key: 'rozetka', label: 'Rozetka' },
] as const

/** Every figure on the page is recomputed for the chosen marketplace. */
function PlatformTabs({ value, onChange }: {
  value: string
  onChange: (p: string) => void
}) {
  return (
    <div className="inline-flex bg-zinc-900 border border-zinc-800 rounded-lg p-0.5">
      {MARKETPLACES.map(m => (
        <button
          key={m.key}
          onClick={() => onChange(m.key)}
          className={`px-3.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
            value === m.key
              ? 'bg-red-600 text-white'
              : 'text-zinc-400 hover:text-white'
          }`}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}

/** One marketplace's worth of figures — the server sends all three at once. */
export interface Bundle {
  totals: Totals
  perDay: DayBucket[]
  products: ProductStat[]
  categories: CategoryStat[]
  customers: CustomerStat[]
  customerSummary: {
    total: number
    repeat: number
    avgLtv: number
    avgOrdersPerCustomer: number
    avgCadence: number | null
  }
  regions: RegionStat[]
  operators: OperatorStat[]
  cancels: CancelStats
}

export default function AnalyticsClient({
  from, to, platform: initialPlatform, bundles, limited = false,
}: {
  from: string
  to: string
  platform: string
  bundles: Record<string, Bundle>
  /** An analyst: the trade, without the blocks that are about the team */
  limited?: boolean
}) {
  const [chartMetric, setChartMetric] = useState<ChartMetric>('count')
  const router = useRouter()
  // A new period genuinely needs the server. Without a transition React blocks
  // on the navigation and nothing on screen acknowledges the click, which reads
  // as the page having hung. The period the user picked is shown right away and
  // the figures fade until the answer arrives.
  const [pending, startTransition] = useTransition()
  const [pickedFrom, setPickedFrom] = useState<[string, string] | null>(null)
  const shownFrom = pending && pickedFrom ? pickedFrom[0] : from
  const shownTo = pending && pickedFrom ? pickedFrom[1] : to

  // Switching marketplace only picks a different pre-computed bundle, so it is
  // instant. The address bar is kept in step without a navigation, which would
  // re-render the whole page on the server for data the browser already holds.
  const [platform, setPlatformState] = useState(initialPlatform)
  const setPlatform = (p: string) => {
    setPlatformState(p)
    const q = new URLSearchParams({ from, to })
    if (p !== 'all') q.set('platform', p)
    window.history.replaceState(null, '', `/analytics?${q}`)
  }
  // A different period does need the server
  const setRange = (f: string, t2: string) => {
    setPickedFrom([f, t2])
    startTransition(() => {
      router.push(`/analytics?from=${f}&to=${t2}${platform === 'all' ? '' : `&platform=${platform}`}`)
    })
  }

  const {
    totals: t, perDay, products, categories, customers, customerSummary, regions, operators,
    cancels,
  } = bundles[platform] ?? bundles.all

  const maxProductQty = Math.max(1, ...products.map(p => p.qty))
  const maxCategoryRevenue = Math.max(1, ...categories.map(c => c.revenue))

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">Аналітика</h1>
          <p className="text-zinc-400 text-sm mt-0.5">
            {dayMonth(shownFrom)} — {dayMonth(shownTo)} ·{' '}
            {pending ? 'рахую…' : `${t.orders} ${orderWord(t.orders)}`}
            {platform !== 'all' && (
              <span className="text-zinc-500">
                {' '}· лише {MARKETPLACES.find(m => m.key === platform)?.label}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <PlatformTabs value={platform} onChange={setPlatform} />
          <PeriodPicker from={shownFrom} to={shownTo} onChange={setRange} pending={pending} />
        </div>
      </div>

      <div className={`space-y-5 transition-opacity duration-150 ${
        pending ? 'opacity-40' : ''
      }`}>

      {/* Money */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card label="Загальний дохід" value={money(t.revenue)} sub="по доставлених" />
        <Card label="Комісія" value={money(t.commission)} sub="по доставлених" tone="amber" />
        <Card label="Чистий дохід" value={money(t.net)} sub="дохід мінус комісія" tone="emerald" />
        <Card
          label="Середній чек"
          value={money(t.avgCheck)}
          sub={`по всіх, крім скасованих — ${money(t.avgCheckAll)}`}
          tone="cyan"
        />
      </div>

      {/* Funnel */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card label="Всього замовлень" value={String(t.orders)} />
        <Card label="Доставлено" value={String(t.delivered)} sub={pct(t.delivered, t.orders)} tone="emerald" />
        <Card label="Скасовано" value={String(t.canceled)} sub={pct(t.canceled, t.orders)} tone="red" />
        <Card label="В процесі" value={String(t.inFlight)} tone="cyan" />
      </div>

      <Panel
        title="Замовлення по днях"
        subtitle={chartMetric === 'count'
          ? 'Наведіть на стовпець для деталей'
          : 'Сума замовлень, зроблених того дня (без скасованих)'}
        right={
          <div className="flex gap-1 shrink-0">
            {([['count', 'Кількість'], ['ordered', 'Сума']] as const).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setChartMetric(k)}
                className={`px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                  chartMetric === k ? 'bg-red-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        }
      >
        <DailyChart data={perDay} metric={chartMetric} />
      </Panel>

      {!limited && <Cancellations c={cancels} />}

      <UkraineMap regions={regions} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        <Panel title="Популярні товари" subtitle="За кількістю проданих одиниць">
          <RankedList
            rows={products}
            max={maxProductQty}
            labelOf={(p: ProductStat) => p.title}
            valueOf={(p: ProductStat) => p.qty}
            metaOf={(p: ProductStat) =>
              `${num(p.qty)} шт · ${moneyShort(p.revenue)} · ${p.orders} зам.`}
          />
        </Panel>

        <Panel title="Популярні категорії" subtitle="За сумою продажів">
          <RankedList
            rows={categories}
            max={maxCategoryRevenue}
            labelOf={(c: CategoryStat) => c.category}
            valueOf={(c: CategoryStat) => c.revenue}
            metaOf={(c: CategoryStat) =>
              `${moneyShort(c.revenue)} · ${num(c.qty)} шт · ${c.orders} зам.`}
          />
        </Panel>
      </div>

      {/* Customers */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Card label="Клієнтів" value={String(customerSummary.total)} />
        <Card
          label="Повторні покупці"
          value={String(customerSummary.repeat)}
          sub={pct(customerSummary.repeat, customerSummary.total)}
          tone="emerald"
        />
        <Card label="Середній LTV" value={money(customerSummary.avgLtv)} tone="cyan" />
        <Card
          label="Замовлень на клієнта"
          value={customerSummary.avgOrdersPerCustomer.toFixed(2)}
        />
        <Card
          label="Періодичність"
          value={customerSummary.avgCadence != null ? `${customerSummary.avgCadence} дн.` : '—'}
          sub="між замовленнями"
          tone="amber"
        />
      </div>

      <CustomersTable rows={customers} />

      {/* Operators — no data source yet, stated plainly rather than faked */}
      {!limited && (
      <Panel
        title="Ефективність операторів"
        subtitle="Рахується лише в межах змін за графіком, 09:00–17:00"
      >
        {operators.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <div className="text-zinc-400 text-sm">Ще немає дій за цей період</div>
            <div className="text-zinc-600 text-xs mt-1.5 max-w-lg mx-auto">
              Враховуються лише користувачі з роллю Оператор. Зміни, які зробив сам
              маркетплейс, нікому не зараховуються.
            </div>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-500 text-xs">
                    <th className="text-left px-5 py-2.5">Оператор</th>
                    <th className="text-right px-5 py-2.5 whitespace-nowrap">Замовлень</th>
                    <th className="text-right px-5 py-2.5 whitespace-nowrap">Дій</th>
                    <th className="text-right px-5 py-2.5 whitespace-nowrap">ТТН</th>
                    <th className="text-right px-5 py-2.5 whitespace-nowrap">Сума</th>
                    <th className="text-right px-5 py-2.5 whitespace-nowrap">Серед. чек</th>
                    <th className="text-right px-5 py-2.5 whitespace-nowrap">Доставлено</th>
                    <th className="text-right px-5 py-2.5 whitespace-nowrap">Скасовано</th>
                    <th className="text-right px-5 py-2.5 whitespace-nowrap">Реакція</th>
                    <th className="text-right px-5 py-2.5 whitespace-nowrap">Опрацювання</th>
                    <th className="text-right px-5 py-2.5 whitespace-nowrap">Присутність</th>
                    <th className="text-right px-5 py-2.5 whitespace-nowrap">Просувань/год</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {operators.map(o => (
                    <tr key={o.id} className="hover:bg-zinc-800/30 transition-colors">
                      <td className="px-5 py-2.5 text-white text-xs">{o.name}</td>
                      <td className="px-5 py-2.5 text-right text-zinc-300 text-xs">{o.orders}</td>
                      <td className="px-5 py-2.5 text-right text-zinc-500 text-xs">{o.actions}</td>
                      <td className="px-5 py-2.5 text-right text-zinc-400 text-xs">{o.ttn || '—'}</td>
                      <td className="px-5 py-2.5 text-right text-white text-xs whitespace-nowrap">{moneyShort(o.revenue)}</td>
                      <td className="px-5 py-2.5 text-right text-zinc-400 text-xs whitespace-nowrap">{moneyShort(o.avgOrder)}</td>
                      <td className="px-5 py-2.5 text-right text-xs whitespace-nowrap">
                        <span className="text-emerald-400">{o.delivered}</span>
                        <span className="text-zinc-600"> · {pct(o.delivered, o.orders)}</span>
                      </td>
                      <td className="px-5 py-2.5 text-right text-xs whitespace-nowrap">
                        <span className="text-red-400">{o.canceled}</span>
                        <span className="text-zinc-600"> · {pct(o.canceled, o.orders)}</span>
                      </td>
                      <td className="px-5 py-2.5 text-right text-zinc-300 text-xs whitespace-nowrap">
                        {o.reactionMins != null ? duration(o.reactionMins) : '—'}
                      </td>
                      <td className="px-5 py-2.5 text-right text-zinc-300 text-xs whitespace-nowrap">
                        {o.handlingMins != null ? duration(o.handlingMins) : '—'}
                      </td>
                      <td className="px-5 py-2.5 text-right text-xs whitespace-nowrap">
                        {o.presencePct != null ? (
                          <span className={
                            o.presencePct >= 85 ? 'text-emerald-400'
                              : o.presencePct >= 60 ? 'text-amber-400' : 'text-red-400'
                          }>
                            {o.presencePct}%
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-5 py-2.5 text-right text-xs whitespace-nowrap">
                        <span className="text-zinc-300">{o.movesPerHour ?? '—'}</span>
                        {o.moves > 0 && <span className="text-zinc-600"> · {o.moves}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 px-5 py-4 border-t border-zinc-800">
              <OperatorBars
                title="Замовлень опрацьовано"
                rows={operators.map(o => ({ name: o.name, value: o.orders }))}
                format={v => String(v)}
              />
              <OperatorBars
                title="Середня реакція"
                rows={operators
                  .filter(o => o.reactionMins != null)
                  .map(o => ({ name: o.name, value: o.reactionMins as number }))}
                format={duration}
                lowerIsBetter
              />
              <OperatorBars
                title="Присутність у зміну"
                rows={operators
                  .filter(o => o.presencePct != null)
                  .map(o => ({ name: o.name, value: o.presencePct as number }))}
                format={v => `${v}%`}
              />
              <OperatorBars
                title="Просувань за годину зміни"
                rows={operators
                  .filter(o => o.movesPerHour != null)
                  .map(o => ({ name: o.name, value: o.movesPerHour as number }))}
                format={v => String(v)}
              />
            </div>

            <div className="px-5 pb-5 border-t border-zinc-800 pt-4 space-y-3">
              <p className="text-zinc-400 text-xs">
                Усі значення — середні. Час рахується лише в межах змін, на які
                оператор стояв у графіку, з 09:00 до 17:00: день не за графіком
                не зараховується нікому, тож ані ніч, ані чужий вихідний не
                потрапляють у цифри.
              </p>

              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
                {METRIC_HELP.map(([term, meaning]) => (
                  <div key={term} className="flex gap-2 text-xs">
                    <dt className="text-zinc-300 shrink-0 w-[104px]">{term}</dt>
                    <dd className="text-zinc-500 flex-1">{meaning}</dd>
                  </div>
                ))}
              </dl>

              {operators.some(o => o.offShiftActions > 0) && (
                <p className="text-amber-500/70 text-xs">
                  Дії поза графіком:{' '}
                  {operators.filter(o => o.offShiftActions > 0)
                    .map(o => `${o.name} — ${o.offShiftActions}`).join(', ')}.
                  {' '}Вони враховані в колонці «Дій», але не в тривалостях.
                </p>
              )}
            </div>
          </>
        )}
      </Panel>
      )}
      </div>
    </div>
  )
}

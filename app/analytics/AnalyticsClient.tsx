'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import UkraineMap from './UkraineMap'
import type {
  Totals, DayBucket, ProductStat, CategoryStat, CustomerStat, RegionStat,
} from '@/lib/analytics'

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
                    <div className="text-emerald-400">доставлено {moneyShort(d.revenue)}</div>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex items-center justify-between mt-3 text-xs text-zinc-500">
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

function PeriodPicker({ from, to, onChange }: {
  from: string
  to: string
  onChange: (from: string, to: string) => void
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
          <span className="text-zinc-300 text-xs min-w-[110px] text-center">{monthLabel(from)}</span>
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

export default function AnalyticsClient({
  from, to, totals: t, perDay, products, categories, customers, customerSummary, regions,
}: {
  from: string
  to: string
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
}) {
  const [chartMetric, setChartMetric] = useState<ChartMetric>('count')
  const router = useRouter()
  const setRange = (f: string, t2: string) =>
    router.push(`/analytics?from=${f}&to=${t2}`)

  const maxProductQty = Math.max(1, ...products.map(p => p.qty))
  const maxCategoryRevenue = Math.max(1, ...categories.map(c => c.revenue))

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">Аналітика</h1>
          <p className="text-zinc-400 text-sm mt-0.5">
            {dayMonth(from)} — {dayMonth(to)} · {t.orders} {orderWord(t.orders)}
          </p>
        </div>
        <PeriodPicker from={from} to={to} onChange={setRange} />
      </div>

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
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
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
      <Panel
        title="Ефективність операторів"
        subtitle="Скільки замовлень опрацьовує кожен оператор і як швидко"
      >
        <div className="px-5 py-8 text-center">
          <div className="text-zinc-400 text-sm">Дані ще не збираються</div>
          <div className="text-zinc-600 text-xs mt-1.5 max-w-lg mx-auto">
            У замовленнях не зберігається, хто саме змінив статус, поставив ТТН чи
            скасував — тому історії по операторах поки немає. Щойно додамо запис цих
            дій, блок наповниться автоматично.
          </div>
        </div>
      </Panel>
    </div>
  )
}

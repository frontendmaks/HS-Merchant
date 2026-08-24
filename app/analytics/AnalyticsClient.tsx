'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import UkraineMap from './UkraineMap'
import type {
  Totals, DayBucket, ProductStat, CategoryStat, CustomerStat, RegionStat,
} from '@/lib/analytics'

import { money, moneyShort, pct, num, dayMonth } from '@/lib/format'

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

/** Bar chart of orders per day, drawn with plain divs. */
function DailyChart({ data }: { data: DayBucket[] }) {
  if (!data.length) {
    return <div className="px-5 py-10 text-center text-zinc-600 text-sm">Немає даних</div>
  }
  const max = Math.max(...data.map(d => d.count))
  const avg = data.reduce((s, d) => s + d.count, 0) / data.length

  return (
    <div className="p-5">
      <div className="flex items-end gap-[2px] h-40" style={{ minHeight: '10rem' }}>
        {data.map(d => {
          const h = max ? (d.count / max) * 100 : 0
          return (
            <div
              key={d.date}
              className="flex-1 min-w-[2px] bg-red-600/70 hover:bg-red-500 rounded-t-sm transition-colors relative group"
              style={{ height: `${Math.max(h, 2)}%` }}
            >
              <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-1 z-10 whitespace-nowrap bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-white">
                {dayMonth(d.date)}{' · '}{d.count} зам.
                {d.revenue > 0 && <> · {moneyShort(d.revenue)}</>}
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex items-center justify-between mt-3 text-xs text-zinc-500">
        <span>{dayMonth(data[0].date)}</span>
        <span className="text-zinc-400">
          У середньому <span className="text-white font-medium">{avg.toFixed(1)}</span> замовлень/день
          {' · '}пік <span className="text-white font-medium">{max}</span>
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

export default function AnalyticsClient({
  months, totals: t, perDay, products, categories, customers, customerSummary, regions,
}: {
  months: number
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
  const router = useRouter()
  const params = useSearchParams()

  const setMonths = (m: number) => {
    const p = new URLSearchParams(params.toString())
    p.set('months', String(m))
    router.push(`/analytics?${p.toString()}`)
  }

  const maxProductQty = Math.max(1, ...products.map(p => p.qty))
  const maxCategoryRevenue = Math.max(1, ...categories.map(c => c.revenue))

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">Аналітика</h1>
          <p className="text-zinc-400 text-sm mt-0.5">
            За останні {months} міс. · {t.orders} замовлень
          </p>
        </div>
        <div className="flex gap-1">
          {[1, 3, 6, 12].map(m => (
            <button
              key={m}
              onClick={() => setMonths(m)}
              className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
                months === m ? 'bg-red-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-white'
              }`}
            >
              {m} міс.
            </button>
          ))}
        </div>
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

      <Panel title="Замовлення по днях" subtitle="Наведіть на стовпець для деталей">
        <DailyChart data={perDay} />
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

      <Panel title="Топ клієнтів за LTV" subtitle="Сума доставлених замовлень">
        {customers.length === 0 ? (
          <div className="px-5 py-10 text-center text-zinc-600 text-sm">Немає даних</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-500 text-xs">
                  <th className="text-left px-5 py-2.5">Клієнт</th>
                  <th className="text-left px-5 py-2.5 whitespace-nowrap">Телефон</th>
                  <th className="text-right px-5 py-2.5 whitespace-nowrap">Замовлень</th>
                  <th className="text-right px-5 py-2.5 whitespace-nowrap">Доставлено</th>
                  <th className="text-right px-5 py-2.5 whitespace-nowrap">LTV</th>
                  <th className="text-right px-5 py-2.5 whitespace-nowrap">Періодичність</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {customers.map(c => (
                  <tr key={c.key} className="hover:bg-zinc-800/30 transition-colors">
                    <td className="px-5 py-2.5 text-white text-xs">{c.name}</td>
                    <td className="px-5 py-2.5 text-zinc-400 text-xs whitespace-nowrap">{c.phone ?? '—'}</td>
                    <td className="px-5 py-2.5 text-right text-zinc-300 text-xs">{c.orders}</td>
                    <td className="px-5 py-2.5 text-right text-emerald-400 text-xs">{c.delivered}</td>
                    <td className="px-5 py-2.5 text-right text-white text-xs whitespace-nowrap">{moneyShort(c.revenue)}</td>
                    <td className="px-5 py-2.5 text-right text-zinc-400 text-xs whitespace-nowrap">
                      {c.cadenceDays != null ? `~${c.cadenceDays} дн.` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

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

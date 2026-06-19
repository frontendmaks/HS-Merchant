export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentRole } from '@/lib/getRole'
import OrdersToolbar from './OrdersToolbar'
import OrderRow from './OrderRow'

const UA_MONTHS = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень']

function getMonthTabs(currentMonth: string) {
  const tabs: { value: string; label: string }[] = []
  const [curYear, curMonthNum] = currentMonth.split('-').map(Number)
  for (let y = 2026; y <= curYear; y++) {
    const maxM = y === curYear ? curMonthNum : 12
    for (let m = 1; m <= maxM; m++) {
      const value = `${y}-${String(m).padStart(2, '0')}`
      tabs.push({ value, label: `${UA_MONTHS[m - 1]} ${y}` })
    }
  }
  return tabs
}

function monthDateRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number)
  const from = `${month}-01`
  const lastDay = new Date(y, m, 0).getDate()
  const to = `${month}-${String(lastDay).padStart(2, '0')}`
  return { from, to }
}

function platformBadge(platform: string | null) {
  const p = platform || ''
  const cls = p === 'maudau'
    ? 'bg-purple-900 text-purple-300'
    : p === 'rozetka'
    ? 'bg-pink-900 text-pink-300'
    : 'bg-zinc-700 text-zinc-300'
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {p === 'maudau' ? 'MauDau' : p === 'rozetka' ? 'Rozetka' : p}
    </span>
  )
}

function fmt(n: number) {
  return n.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function pct(part: number, total: number) {
  if (!total) return '0%'
  return (part / total * 100).toFixed(1) + '%'
}

interface SearchParams {
  platform?: string
  status?: string
  search?: string
  month?: string
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const sp = await searchParams
  const platform = sp.platform || ''
  const statusFilter = sp.status || ''
  const search = sp.search || ''
  const currentMonth = new Date().toISOString().slice(0, 7)
  const selectedMonth = sp.month || currentMonth

  const { from, to } = monthDateRange(selectedMonth)
  const tabs = getMonthTabs(currentMonth)

  const role = await getCurrentRole()
  const readOnly = role === 'viewer'

  const supabase = createServiceClient()

  const { data: allOrders } = await supabase
    .from('orders')
    .select('platform,status,total,commission')
    .gte('order_date', from)
    .lte('order_date', to)

  const orders = allOrders || []
  const total = orders.length
  const delivered = orders.filter(o => o.status === 'Доставлено')
  const canceled = orders.filter(o => o.status === 'Скасовано')
  const inProgress = orders.filter(o => o.status !== 'Доставлено' && o.status !== 'Скасовано')

  const revenue = delivered.reduce((s, o) => s + Number(o.total || 0), 0)
  const commissionSum = delivered.reduce((s, o) => s + Number(o.commission || 0), 0)
  const netRevenue = revenue - commissionSum

  const platforms = ['maudau', 'rozetka']
  const breakdown = platforms.map(pl => {
    const pOrders = orders.filter(o => o.platform === pl)
    const pDelivered = pOrders.filter(o => o.status === 'Доставлено')
    const pCanceled = pOrders.filter(o => o.status === 'Скасовано')
    const pRevenue = pDelivered.reduce((s, o) => s + Number(o.total || 0), 0)
    const pCommission = pDelivered.reduce((s, o) => s + Number(o.commission || 0), 0)
    return {
      platform: pl,
      total: pOrders.length,
      delivered: pDelivered.length,
      canceled: pCanceled.length,
      revenue: pRevenue,
      commission: pCommission,
      net: pRevenue - pCommission,
    }
  })

  let query = supabase
    .from('orders')
    .select('*')
    .gte('order_date', from)
    .lte('order_date', to)
    .order('order_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (platform) query = query.eq('platform', platform)
  if (statusFilter === 'other') {
    query = query.neq('status', 'Доставлено').neq('status', 'Скасовано')
  } else if (statusFilter) {
    query = query.eq('status', statusFilter)
  }
  if (search) {
    query = query.or(`customer_name.ilike.%${search}%,external_id.ilike.%${search}%,customer_phone.ilike.%${search}%`)
  }

  const { data: tableOrders } = await query

  function buildTabHref(month: string) {
    const params = new URLSearchParams()
    params.set('month', month)
    if (platform) params.set('platform', platform)
    if (statusFilter) params.set('status', statusFilter)
    if (search) params.set('search', search)
    return `?${params.toString()}`
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Замовлення</h1>
          <p className="text-zinc-400 text-sm mt-0.5">Всі замовлення з MauDau та Rozetka</p>
        </div>
      </div>

      <Suspense fallback={null}>
        <OrdersToolbar />
      </Suspense>

      {/* Month tabs */}
      <div className="overflow-x-auto">
        <div className="flex gap-1 min-w-max">
          {tabs.map(tab => (
            <Link
              key={tab.value}
              href={buildTabHref(tab.value)}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors whitespace-nowrap ${
                tab.value === selectedMonth
                  ? 'bg-red-600 text-white'
                  : 'bg-zinc-800/50 text-zinc-400 hover:text-white hover:bg-zinc-800'
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </div>

      {/* Analytics cards */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-zinc-900 rounded-xl p-3 border border-zinc-800">
          <div className="text-zinc-400 text-xs font-medium uppercase tracking-wide mb-1">Всього замовлень</div>
          <div className="text-3xl font-bold text-white">{total}</div>
        </div>
        <div className="bg-zinc-900 rounded-xl p-3 border border-zinc-800">
          <div className="text-zinc-400 text-xs font-medium uppercase tracking-wide mb-1">Доставлено</div>
          <div className="text-3xl font-bold text-emerald-400">{delivered.length}</div>
          <div className="text-zinc-500 text-sm mt-0.5">{pct(delivered.length, total)}</div>
        </div>
        <div className="bg-zinc-900 rounded-xl p-3 border border-zinc-800">
          <div className="text-zinc-400 text-xs font-medium uppercase tracking-wide mb-1">Скасовано</div>
          <div className="text-3xl font-bold text-red-400">{canceled.length}</div>
          <div className="text-zinc-500 text-sm mt-0.5">{pct(canceled.length, total)}</div>
        </div>
        <div className="bg-zinc-900 rounded-xl p-3 border border-zinc-800">
          <div className="text-zinc-400 text-xs font-medium uppercase tracking-wide mb-1">В процесі</div>
          <div className="text-3xl font-bold text-cyan-400">{inProgress.length}</div>
        </div>
      </div>

      {/* Revenue cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-zinc-900 rounded-xl p-3 border border-zinc-800">
          <div className="text-zinc-400 text-xs font-medium uppercase tracking-wide mb-1">Загальний дохід</div>
          <div className="text-2xl font-bold text-white">₴{fmt(revenue)}</div>
          <div className="text-zinc-500 text-xs mt-0.5">По доставлених замовленнях</div>
        </div>
        <div className="bg-zinc-900 rounded-xl p-3 border border-zinc-800">
          <div className="text-zinc-400 text-xs font-medium uppercase tracking-wide mb-1">Комісія</div>
          <div className="text-2xl font-bold text-amber-400">₴{fmt(commissionSum)}</div>
          <div className="text-zinc-500 text-xs mt-0.5">По доставлених замовленнях</div>
        </div>
        <div className="bg-zinc-900 rounded-xl p-3 border border-zinc-800">
          <div className="text-zinc-400 text-xs font-medium uppercase tracking-wide mb-1">Чистий дохід</div>
          <div className="text-2xl font-bold text-emerald-400">₴{fmt(netRevenue)}</div>
          <div className="text-zinc-500 text-xs mt-0.5">Дохід мінус комісія</div>
        </div>
      </div>

      {/* Platform breakdown */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-300">По платформах</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-500 text-xs">
              <th className="text-left px-4 py-2">Платформа</th>
              <th className="text-right px-4 py-2">Всього</th>
              <th className="text-right px-4 py-2">Доставлено</th>
              <th className="text-right px-4 py-2">% дост.</th>
              <th className="text-right px-4 py-2">Скасовано</th>
              <th className="text-right px-4 py-2">% скас.</th>
              <th className="text-right px-4 py-2">Виторг</th>
              <th className="text-right px-4 py-2">Комісія</th>
              <th className="text-right px-4 py-2">Чистий</th>
            </tr>
          </thead>
          <tbody>
            {breakdown.map(b => (
              <tr key={b.platform} className="border-b border-zinc-800/50">
                <td className="px-4 py-2.5">{platformBadge(b.platform)}</td>
                <td className="text-right px-4 py-2.5 text-zinc-300">{b.total}</td>
                <td className="text-right px-4 py-2.5 text-emerald-400">{b.delivered}</td>
                <td className="text-right px-4 py-2.5 text-zinc-400">{pct(b.delivered, b.total)}</td>
                <td className="text-right px-4 py-2.5 text-red-400">{b.canceled}</td>
                <td className="text-right px-4 py-2.5 text-zinc-400">{pct(b.canceled, b.total)}</td>
                <td className="text-right px-4 py-2.5 text-zinc-300">₴{fmt(b.revenue)}</td>
                <td className="text-right px-4 py-2.5 text-amber-400">₴{fmt(b.commission)}</td>
                <td className="text-right px-4 py-2.5 text-emerald-400">₴{fmt(b.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Orders table */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-300">
            Замовлення
            {tableOrders && <span className="ml-2 text-zinc-500">({tableOrders.length})</span>}
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500 text-xs">
                <th className="text-left px-3 py-2 whitespace-nowrap">Дата</th>
                <th className="text-left px-3 py-2 whitespace-nowrap">Номер</th>
                <th className="text-left px-3 py-2 whitespace-nowrap">Платформа</th>
                <th className="text-left px-3 py-2 whitespace-nowrap">ПІБ</th>
                <th className="text-left px-3 py-2 whitespace-nowrap">Телефон</th>
                <th className="text-left px-3 py-2 whitespace-nowrap">Адреса</th>
                <th className="text-left px-3 py-2">Товари</th>
                <th className="text-right px-3 py-2 whitespace-nowrap">Сума</th>
                <th className="text-right px-3 py-2 whitespace-nowrap">Комісія</th>
                <th className="text-left px-3 py-2 whitespace-nowrap">Статус</th>
                <th className="text-left px-3 py-2 whitespace-nowrap">ТТН</th>
                <th className="text-left px-3 py-2 whitespace-nowrap">Причина скасування</th>
              </tr>
            </thead>
            <tbody>
              {!tableOrders?.length ? (
                <tr>
                  <td colSpan={12} className="text-center py-12 text-zinc-500">
                    Немає замовлень
                  </td>
                </tr>
              ) : (
                tableOrders.map(order => (
                  <OrderRow
                    key={order.id}
                    id={order.id}
                    external_id={order.external_id}
                    platform={order.platform}
                    order_date={order.order_date}
                    customer_name={order.customer_name}
                    customer_phone={order.customer_phone}
                    address={order.address}
                    items={order.items}
                    total={order.total}
                    commission={order.commission}
                    status={order.status}
                    ttn={order.ttn}
                    cancel_reason={order.cancel_reason}
                    readOnly={readOnly}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

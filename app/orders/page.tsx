export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import { createServiceClient } from '@/lib/supabase/service'
import OrdersToolbar from './OrdersToolbar'

const PAGE_SIZE = 50

function statusBadge(status: string | null) {
  const s = status || ''
  let cls = 'bg-zinc-700 text-zinc-300'
  if (s === 'Доставлено') cls = 'bg-emerald-900 text-emerald-300'
  else if (s === 'Скасовано') cls = 'bg-red-900 text-red-300'
  else if (s === 'Нове') cls = 'bg-amber-900 text-amber-300'
  else if (s === 'Прийнято' || s === 'Узгоджено') cls = 'bg-blue-900 text-blue-300'
  else if (s === 'На доставці' || s === 'Доставляється' || s === 'Передано в доставку' || s === 'Чекає в пункті') cls = 'bg-cyan-900 text-cyan-300'
  else if (s === 'Опрацьовується' || s === 'Комплектується') cls = 'bg-yellow-900 text-yellow-300'
  else if (s === 'Прибуло') cls = 'bg-orange-900 text-orange-300'
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {s || '—'}
    </span>
  )
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
  page?: string
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
  const page = Math.max(1, parseInt(sp.page || '1', 10))

  const supabase = createServiceClient()

  // Analytics — all orders
  const { data: allOrders } = await supabase
    .from('orders')
    .select('platform,status,total,commission')

  const orders = allOrders || []
  const total = orders.length
  const delivered = orders.filter(o => o.status === 'Доставлено')
  const canceled = orders.filter(o => o.status === 'Скасовано')
  const inProgress = orders.filter(o => o.status !== 'Доставлено' && o.status !== 'Скасовано')

  const revenue = delivered.reduce((s, o) => s + Number(o.total || 0), 0)
  const commissionSum = delivered.reduce((s, o) => s + Number(o.commission || 0), 0)
  const netRevenue = revenue - commissionSum

  // Platform breakdown
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

  // Table query with filters
  let query = supabase
    .from('orders')
    .select('*', { count: 'exact' })
    .order('order_date', { ascending: false })
    .order('created_at', { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)

  if (platform) query = query.eq('platform', platform)
  if (statusFilter === 'other') {
    query = query.neq('status', 'Доставлено').neq('status', 'Скасовано')
  } else if (statusFilter) {
    query = query.eq('status', statusFilter)
  }
  if (search) {
    query = query.or(`customer_name.ilike.%${search}%,external_id.ilike.%${search}%`)
  }

  const { data: tableOrders, count } = await query
  const totalPages = Math.ceil((count || 0) / PAGE_SIZE)

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Замовлення</h1>
          <p className="text-zinc-400 text-sm mt-0.5">Всі замовлення з MauDau та Rozetka</p>
        </div>
      </div>

      {/* Toolbar (client) */}
      <Suspense fallback={null}>
        <OrdersToolbar />
      </Suspense>

      {/* Analytics cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
          <div className="text-zinc-400 text-xs font-medium uppercase tracking-wide mb-1">Всього замовлень</div>
          <div className="text-3xl font-bold text-white">{total}</div>
        </div>
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
          <div className="text-zinc-400 text-xs font-medium uppercase tracking-wide mb-1">Доставлено</div>
          <div className="text-3xl font-bold text-emerald-400">{delivered.length}</div>
          <div className="text-zinc-500 text-sm mt-0.5">{pct(delivered.length, total)}</div>
        </div>
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
          <div className="text-zinc-400 text-xs font-medium uppercase tracking-wide mb-1">Скасовано</div>
          <div className="text-3xl font-bold text-red-400">{canceled.length}</div>
          <div className="text-zinc-500 text-sm mt-0.5">{pct(canceled.length, total)}</div>
        </div>
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
          <div className="text-zinc-400 text-xs font-medium uppercase tracking-wide mb-1">В процесі</div>
          <div className="text-3xl font-bold text-cyan-400">{inProgress.length}</div>
        </div>
      </div>

      {/* Revenue cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
          <div className="text-zinc-400 text-xs font-medium uppercase tracking-wide mb-1">Загальний дохід</div>
          <div className="text-2xl font-bold text-white">₴{fmt(revenue)}</div>
          <div className="text-zinc-500 text-xs mt-0.5">По доставлених замовленнях</div>
        </div>
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
          <div className="text-zinc-400 text-xs font-medium uppercase tracking-wide mb-1">Комісія</div>
          <div className="text-2xl font-bold text-amber-400">₴{fmt(commissionSum)}</div>
          <div className="text-zinc-500 text-xs mt-0.5">По доставлених замовленнях</div>
        </div>
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
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
        <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-300">
            Замовлення
            {count !== null && <span className="ml-2 text-zinc-500">({count})</span>}
          </h2>
          {totalPages > 1 && (
            <div className="text-xs text-zinc-500">
              Сторінка {page} з {totalPages}
            </div>
          )}
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
                <th className="text-left px-3 py-2 max-w-xs">Товари</th>
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
                  <tr key={order.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                    <td className="px-3 py-2 whitespace-nowrap text-zinc-400 text-xs">{order.order_date || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-zinc-300 font-mono text-xs">{order.external_id}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{platformBadge(order.platform)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-zinc-300 text-xs">{order.customer_name || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-zinc-400 text-xs">{order.customer_phone || '—'}</td>
                    <td className="px-3 py-2 text-zinc-400 text-xs max-w-[180px]">
                      <div className="truncate" title={order.address || ''}>{order.address || '—'}</div>
                    </td>
                    <td className="px-3 py-2 max-w-xs">
                      <div className="text-zinc-400 text-xs truncate max-w-[200px]" title={order.items || ''}>
                        {order.items ? order.items.split('\n')[0] : '—'}
                        {order.items && order.items.includes('\n') && (
                          <span className="text-zinc-600"> +ще</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-right text-zinc-300 text-xs">
                      {order.total != null ? `₴${fmt(Number(order.total))}` : '—'}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-right text-amber-400 text-xs">
                      {order.commission != null ? `₴${fmt(Number(order.commission))}` : '—'}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{statusBadge(order.status)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-zinc-400 text-xs font-mono">{order.ttn || '—'}</td>
                    <td className="px-3 py-2 text-zinc-500 text-xs max-w-[120px] truncate">{order.cancel_reason || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-zinc-800 flex items-center justify-center gap-2">
            {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => i + 1).map(p => (
              <a
                key={p}
                href={`?${new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([k]) => k !== 'page')), ...(p > 1 ? { page: String(p) } : {}) }).toString()}`}
                className={`px-3 py-1 rounded text-sm transition-colors ${
                  p === page
                    ? 'bg-red-600 text-white'
                    : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                }`}
              >
                {p}
              </a>
            ))}
            {totalPages > 10 && <span className="text-zinc-600 text-sm">...</span>}
          </div>
        )}
      </div>
    </div>
  )
}

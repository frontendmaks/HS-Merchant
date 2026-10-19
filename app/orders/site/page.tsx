export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentRole } from '@/lib/getRole'
import { isInProgress } from '@/lib/order-statuses'
import { SITE_PLATFORMS, platformLabel } from '@/lib/order-source'
import StatusSelect from '../StatusSelect'
import WideScroll from '../WideScroll'
import SyncButton from './SyncButton'
import EditButton from './EditButton'

/**
 * Замовлення з сайту й телефону.
 *
 * Тут важливе інше, ніж на маркетплейсах: не ТТН і комісія, а куди й коли
 * везти — склад, дата, період. Звідси й колонки, і бланк для комірника
 * поруч із кожним рядком.
 */

const UA_MONTHS = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня',
  'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня']

function shortDate(date: string | null) {
  if (!date) return '—'
  const [, m, d] = date.split('-')
  return `${Number(d)} ${UA_MONTHS[Number(m) - 1] ?? ''}`
}

const money = (n: number | null) =>
  (n ?? 0).toLocaleString('uk-UA', { maximumFractionDigits: 0 }) + ' ₴'

export default async function SiteOrdersPage() {
  const role = await getCurrentRole()
  const readOnly = role === 'viewer'

  const supabase = createServiceClient()
  const { data: zones } = await supabase.from('delivery_zones').select('warehouse')
  const warehouses = [...new Set((zones ?? []).map(z => z.warehouse as string))].sort()

  const { data } = await supabase
    .from('orders')
    .select('id, external_id, manual_number, number_source, platform, order_date, customer_name, customer_phone, address, warehouse, delivery_zone, delivery_date, delivery_slot, total, status, share_token')
    .in('platform', [...SITE_PLATFORMS])
    .order('delivery_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(300)

  const orders = data ?? []
  const active = orders.filter(o => isInProgress(o.status))

  return (
    <div className="bg-zinc-950 text-white space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">Замовлення (Сайт)</h1>
          <p className="text-zinc-400 text-sm mt-0.5">
            Сайт і телефон — склад, період доставки, бланк для комірника
          </p>
        </div>
        <div className="flex items-start gap-2">
          <SyncButton />
          <Link
            href="/orders/manual"
            className="bg-red-600 hover:bg-red-500 text-white text-sm font-medium
                       px-4 py-2 rounded-lg transition-colors"
          >
            + Нове замовлення
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="bg-zinc-900 rounded-xl p-3 border border-zinc-800">
          <div className="text-zinc-400 text-xs font-medium uppercase tracking-wide mb-1">Усього</div>
          <div className="text-3xl font-bold text-white">{orders.length}</div>
        </div>
        <div className="bg-zinc-900 rounded-xl p-3 border border-zinc-800">
          <div className="text-zinc-400 text-xs font-medium uppercase tracking-wide mb-1">У роботі</div>
          <div className="text-3xl font-bold text-cyan-400">{active.length}</div>
        </div>
        <div className="bg-zinc-900 rounded-xl p-3 border border-zinc-800">
          <div className="text-zinc-400 text-xs font-medium uppercase tracking-wide mb-1">Доставлено</div>
          <div className="text-3xl font-bold text-emerald-400">
            {orders.filter(o => o.status === 'Доставлено').length}
          </div>
        </div>
      </div>

      <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-300">
            Замовлення <span className="ml-1 text-zinc-500">({orders.length})</span>
          </h2>
        </div>
        <WideScroll>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500 text-xs">
                <th className="text-left px-3 py-2 whitespace-nowrap">Номер</th>
                <th className="text-left px-3 py-2 whitespace-nowrap">Джерело</th>
                <th className="text-left px-3 py-2 whitespace-nowrap">Доставка</th>
                <th className="text-left px-3 py-2 whitespace-nowrap">Склад</th>
                <th className="text-left px-3 py-2 whitespace-nowrap">Клієнт</th>
                <th className="text-left px-3 py-2 whitespace-nowrap">Телефон</th>
                <th className="text-left px-3 py-2">Адреса</th>
                <th className="text-right px-3 py-2 whitespace-nowrap">Сума</th>
                <th className="text-left px-3 py-2 whitespace-nowrap">Статус</th>
                <th className="px-3 py-2"></th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={11} className="text-center py-12 text-zinc-500">
                    Замовлень ще немає —{' '}
                    <Link href="/orders/manual" className="text-red-400 hover:text-red-300">
                      створити перше
                    </Link>
                  </td>
                </tr>
              ) : orders.map(o => (
                <tr key={o.id} className="border-b border-zinc-800/60 last:border-0 align-top">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="text-white">
                      {o.manual_number ? `№${o.manual_number}` : o.external_id || '—'}
                    </span>
                    {o.number_source === 'local' && (
                      <span className="block text-amber-500 text-xs" title="Номер узято локально, не з журналу">
                        не з журналу
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="inline-block px-2 py-0.5 rounded text-xs font-medium
                                     bg-zinc-800 text-zinc-300">
                      {platformLabel(o.platform)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-zinc-300 whitespace-nowrap text-xs">
                    {shortDate(o.delivery_date)}
                    {o.delivery_slot && <span className="block text-zinc-500">{o.delivery_slot}</span>}
                  </td>
                  <td className="px-3 py-2 text-zinc-300 text-xs whitespace-nowrap">
                    {o.warehouse || '—'}
                    {o.delivery_zone && (
                      <span className="block text-zinc-600">{o.delivery_zone}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-zinc-300">{o.customer_name || '—'}</td>
                  <td className="px-3 py-2 text-zinc-400 whitespace-nowrap">{o.customer_phone || '—'}</td>
                  <td className="px-3 py-2 text-zinc-400 text-xs max-w-[18rem]">{o.address || '—'}</td>
                  <td className="px-3 py-2 text-right text-white tabular-nums whitespace-nowrap">
                    {money(o.total)}
                  </td>
                  <td className="px-3 py-2">
                    <StatusSelect
                      id={o.id}
                      platform={o.platform}
                      externalId={o.external_id}
                      status={o.status}
                      disabled={readOnly}
                    />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <EditButton id={o.id} warehouses={warehouses} />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {o.share_token && (
                      <a
                        href={`/zamovlennya/${o.share_token}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-zinc-400 hover:text-white text-xs transition-colors"
                      >
                        Бланк ↗
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </WideScroll>
      </div>
    </div>
  )
}

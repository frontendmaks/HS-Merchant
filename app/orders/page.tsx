export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentRole } from '@/lib/getRole'
import { isInProgress, isNew } from '@/lib/order-statuses'
import { orderSource, platformLabel, processingHref } from '@/lib/order-source'
import StatusSelect from './StatusSelect'
import WideScroll from './WideScroll'

/**
 * Оглядова вкладка: що прийшло і звідки.
 *
 * Опрацьовують замовлення не тут — маркетплейсне потребує ТТН і комісії,
 * замовлення з сайту — складу й періоду доставки, і зводити обидва набори
 * полів в один рядок означало б показувати оператору половину порожніх
 * клітинок. Тут видно потік і можна перевести статус; решта — за посиланням
 * у своїй вкладці.
 */

const UA_MONTHS = ['Січня', 'Лютого', 'Березня', 'Квітня', 'Травня', 'Червня',
  'Липня', 'Серпня', 'Вересня', 'Жовтня', 'Листопада', 'Грудня']

function shortDate(date: string | null) {
  if (!date) return '—'
  const [, m, d] = date.split('-')
  return `${Number(d)} ${UA_MONTHS[Number(m) - 1] ?? ''}`
}

const money = (n: number | null) =>
  (n ?? 0).toLocaleString('uk-UA', { maximumFractionDigits: 0 }) + ' ₴'

function SourceCard({ title, href, orders }: {
  title: string
  href: string
  orders: { status: string | null; total: number | null }[]
}) {
  const fresh = orders.filter(o => isNew(o.status)).length
  const working = orders.filter(o => isInProgress(o.status) && !isNew(o.status)).length
  const sum = orders.reduce((s, o) => s + (o.total ?? 0), 0)

  return (
    <Link
      href={href}
      className="bg-zinc-900 rounded-xl p-4 border border-zinc-800 hover:border-zinc-700
                 transition-colors block"
    >
      <div className="flex items-center justify-between">
        <span className="text-zinc-300 text-sm font-semibold">{title}</span>
        <span className="text-zinc-500 text-xs">Опрацювати →</span>
      </div>
      <div className="flex items-end gap-4 mt-2">
        <div>
          <div className="text-3xl font-bold text-white">{orders.length}</div>
          <div className="text-zinc-500 text-xs">за місяць · {money(sum)}</div>
        </div>
        <div className="ml-auto text-right">
          <div className="text-zinc-400 text-xs">
            нових <span className="text-white font-semibold">{fresh}</span>
          </div>
          <div className="text-zinc-400 text-xs">
            у роботі <span className="text-white font-semibold">{working}</span>
          </div>
        </div>
      </div>
    </Link>
  )
}

export default async function OrdersOverviewPage() {
  const month = new Date().toISOString().slice(0, 7)
  const [year, m] = month.split('-').map(Number)
  const from = `${month}-01`
  const to = `${month}-${String(new Date(year, m, 0).getDate()).padStart(2, '0')}`

  const role = await getCurrentRole()
  const readOnly = role === 'viewer'

  const supabase = createServiceClient()
  const { data } = await supabase
    .from('orders')
    .select('id, external_id, manual_number, platform, order_date, customer_name, total, status, delivery_date, delivery_slot')
    .gte('order_date', from)
    .lte('order_date', to)
    .order('order_date', { ascending: false })
    .order('created_at', { ascending: false })

  const orders = data ?? []
  const marketplace = orders.filter(o => orderSource(o.platform) === 'marketplace')
  const site = orders.filter(o => orderSource(o.platform) === 'site')

  // Увага оператора — на тому, що ще не закрите; решта місяця нижче, повним списком
  const active = orders.filter(o => isInProgress(o.status))

  return (
    <div className="bg-zinc-950 text-white space-y-4">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-white">Замовлення</h1>
        <p className="text-zinc-400 text-sm mt-0.5">
          Що прийшло і звідки. Опрацювання — у вкладці джерела
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <SourceCard title="Маркетплейси" href="/orders/marketplaces" orders={marketplace} />
        <SourceCard title="Сайт і телефон" href="/orders/site" orders={site} />
      </div>

      <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-zinc-300">
            У роботі <span className="ml-1 text-zinc-500">({active.length})</span>
          </h2>
          <span className="text-zinc-600 text-xs">
            {orders.length} за {UA_MONTHS[m - 1]?.toLowerCase()} {year}
          </span>
        </div>
        <WideScroll>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500 text-xs">
                <th className="text-left px-3 py-2 whitespace-nowrap">Дата</th>
                <th className="text-left px-3 py-2 whitespace-nowrap">Номер</th>
                <th className="text-left px-3 py-2 whitespace-nowrap">Джерело</th>
                <th className="text-left px-3 py-2 whitespace-nowrap">Клієнт</th>
                <th className="text-left px-3 py-2 whitespace-nowrap">Доставка</th>
                <th className="text-right px-3 py-2 whitespace-nowrap">Сума</th>
                <th className="text-left px-3 py-2 whitespace-nowrap">Статус</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {active.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-zinc-500">
                    Усе опрацьовано
                  </td>
                </tr>
              ) : active.map(o => (
                <tr key={o.id} className="border-b border-zinc-800/60 last:border-0">
                  <td className="px-3 py-2 text-zinc-400 whitespace-nowrap">
                    {shortDate(o.order_date)}
                  </td>
                  <td className="px-3 py-2 text-white whitespace-nowrap">
                    {o.manual_number ? `№${o.manual_number}` : o.external_id || '—'}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="inline-block px-2 py-0.5 rounded text-xs font-medium
                                     bg-zinc-800 text-zinc-300">
                      {platformLabel(o.platform)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-zinc-300">{o.customer_name || '—'}</td>
                  <td className="px-3 py-2 text-zinc-400 whitespace-nowrap text-xs">
                    {o.delivery_date
                      ? `${shortDate(o.delivery_date)}${o.delivery_slot ? `, ${o.delivery_slot}` : ''}`
                      : '—'}
                  </td>
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
                    <Link
                      href={processingHref(o.platform)}
                      className="text-zinc-400 hover:text-white text-xs transition-colors"
                    >
                      Опрацювати →
                    </Link>
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

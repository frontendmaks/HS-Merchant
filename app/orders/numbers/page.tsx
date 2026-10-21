import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentRole, canAccess } from '@/lib/getRole'
import { registerFor, NUMBERS_PER_DAY } from '@/lib/number-register'
import { dayMonth } from '@/lib/format'
import DayPicker from './DayPicker'

export const dynamic = 'force-dynamic'

/**
 * Журнал номерів ящиків.
 *
 * Те саме, що в аркуші на складі, але з історією: видно не лише хто
 * тримає номер, а й коли його взяли, за яким замовленням і чому
 * звільнили. В аркуші цього не спитати — там лише ім'я навпроти числа.
 */
export default async function NumbersPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  const role = await getCurrentRole()
  if (!canAccess('orders', role)) redirect('/')

  const sp = await searchParams
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Kyiv' })
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? '') ? sp.date! : today

  const service = createServiceClient()
  const [rows, { data: orders }] = await Promise.all([
    registerFor(service, date),
    service.from('orders')
      .select('id, manual_number, customer_name, status, external_id, number_source')
      .eq('delivery_date', date)
      .not('manual_number', 'is', null)
      .not('number_source', 'is', null),
  ])

  const byNumber = new Map(rows.map(r => [r.number, r]))
  const orderByNumber = new Map(
    (orders ?? []).map(o => [Number(o.manual_number), o]),
  )

  const held = rows.filter(r => !r.released_at)
  /* Номер, що стоїть у замовленні, але не потрапив у журнал — розбіжність
     між двома записами, і бачити її треба одразу */
  const missing = [...orderByNumber.keys()]
    .filter(n => !byNumber.get(n) || byNumber.get(n)!.released_at)
    .sort((a, b) => a - b)

  const lastUsed = Math.max(0, ...held.map(r => r.number), ...orderByNumber.keys())
  const shown = Math.min(NUMBERS_PER_DAY, Math.max(lastUsed + 10, 60))
  const grid = Array.from({ length: shown }, (_, i) => i + 1)

  return (
    <div className="bg-zinc-950 text-white space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Номери ящиків</h1>
          <p className="text-zinc-400 text-sm mt-0.5">
            {dayMonth(date)} · зайнято {held.length} із {NUMBERS_PER_DAY}
          </p>
        </div>
        <DayPicker date={date} today={today} />
      </div>

      {missing.length > 0 && (
        <div className="bg-amber-950/40 border border-amber-900 rounded-lg px-3 py-2
                        text-amber-400 text-xs">
          У журналі немає {missing.length} {missing.length === 1 ? 'номера' : 'номерів'},
          які стоять у замовленнях: {missing.join(', ')}.
          Їх видали до того, як журнал запрацював, або повз нього.
        </div>
      )}

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
        <div className="flex flex-wrap gap-1.5">
          {grid.map(n => {
            const row = byNumber.get(n)
            const order = orderByNumber.get(n)
            const busy = (row && !row.released_at) || !!order

            const title = busy
              ? [
                  row?.customer_name ?? order?.customer_name ?? 'без імені',
                  order?.status,
                  row ? `взято ${new Date(row.taken_at).toLocaleString('uk-UA')}` : 'немає в журналі',
                ].filter(Boolean).join(' · ')
              : row?.released_at
                ? `звільнено: ${row.released_reason ?? 'без причини'}`
                : 'вільний'

            const body = (
              <span
                title={title}
                className={`inline-flex items-center justify-center w-10 h-8 rounded text-xs
                            tabular-nums transition-colors ${
                  busy
                    ? 'bg-red-600/80 text-white hover:bg-red-500'
                    : row?.released_at
                      ? 'bg-zinc-700 text-zinc-300'
                      : 'bg-zinc-800 text-zinc-600'
                }`}
              >
                {n}
              </span>
            )

            return order
              ? <Link key={n} href={`/orders/site?date=${date}&stage=all&q=${order.manual_number}`}>{body}</Link>
              : <span key={n}>{body}</span>
          })}
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-4 text-xs text-zinc-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-red-600/80" /> зайнятий
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-zinc-700" /> звільнений — знову в обігу
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-zinc-800" /> не видавався
          </span>
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800 text-sm font-semibold text-zinc-300">
          Історія дня
        </div>
        {rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-zinc-600 text-sm">
            Цього дня журнал ще порожній
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500 text-xs">
                <th className="text-left px-4 py-2">№</th>
                <th className="text-left px-4 py-2">Клієнт</th>
                <th className="text-left px-4 py-2">Взято</th>
                <th className="text-left px-4 py-2">Звільнено</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.number} className="border-b border-zinc-800/60">
                  <td className="px-4 py-2 tabular-nums text-white">{r.number}</td>
                  <td className="px-4 py-2 text-zinc-300">{r.customer_name ?? '—'}</td>
                  <td className="px-4 py-2 text-zinc-500 text-xs">
                    {new Date(r.taken_at).toLocaleString('uk-UA')}
                  </td>
                  <td className="px-4 py-2 text-zinc-500 text-xs">
                    {r.released_at
                      ? `${new Date(r.released_at).toLocaleString('uk-UA')} — ${r.released_reason ?? ''}`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export const dynamic = 'force-dynamic'

import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentRole, canAccess } from '@/lib/getRole'
import { redirect } from 'next/navigation'
import CustomerRow, { type Customer } from './CustomerRow'
import CustomerSearch from './CustomerSearch'
import WideScroll from '../orders/WideScroll'

/**
 * Клієнти.
 *
 * Збираються із замовлень — маркетплейсних, сайтових і телефонних — за
 * номером телефону. Окремої бази немає навмисне: дані про клієнта вже лежать
 * у замовленнях, і друга їх копія означала б дві правди про одну людину.
 */

const money = (n: number | null) =>
  (Number(n) || 0).toLocaleString('uk-UA', { maximumFractionDigits: 0 }) + ' ₴'

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sort?: string }>
}) {
  const role = await getCurrentRole()
  if (!canAccess('customers', role)) redirect('/orders')

  const { q = '', sort = 'last' } = await searchParams
  const service = createServiceClient()

  let query = service.from('customers').select('*')

  if (q.trim()) {
    const digits = q.replace(/\D/g, '')
    // Один рядок на всі поля: ім'я, адреса, будь-який із номерів. Нуль
    // попереду відкидаємо — «0677…» і «+38067…» це той самий номер
    const needle = digits.length >= 3
      ? digits.replace(/^0+/, '')
      : q.trim().toLowerCase()
    query = query.ilike('search', `%${needle.replace(/[%_]/g, ' ')}%`)
  }

  query = sort === 'orders'
    ? query.order('orders_count', { ascending: false })
    : sort === 'spent'
    ? query.order('total_spent', { ascending: false })
    : query.order('last_order', { ascending: false })

  // Рахуємо окремо: у списку лежить сторінка, а в картці має стояти скільки
  // їх насправді — інакше «300» означало б рівно те, що ми показали
  const [{ data }, { count }] = await Promise.all([
    query.limit(300),
    service.from('customers').select('phone_key', { count: 'exact', head: true }),
  ])
  const customers = (data ?? []) as Customer[]

  const totals = customers.reduce(
    (a, c) => ({
      orders: a.orders + Number(c.orders_count),
      spent: a.spent + Number(c.total_spent ?? 0),
      repeat: a.repeat + (Number(c.orders_count) > 1 ? 1 : 0),
    }),
    { orders: 0, spent: 0, repeat: 0 },
  )

  const tab = (value: string, label: string) => (
    <a
      href={`?${new URLSearchParams({ ...(q ? { q } : {}), sort: value })}`}
      className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
        sort === value ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'
      }`}
    >
      {label}
    </a>
  )

  return (
    <div className="bg-zinc-950 text-white space-y-4">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-white">Клієнти</h1>
        <p className="text-zinc-400 text-sm mt-0.5">
          Зібрані із замовлень за номером телефону — маркетплейси, сайт і телефон разом
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="bg-zinc-900 rounded-xl p-3 border border-zinc-800">
          <div className="text-zinc-400 text-xs font-medium uppercase tracking-wide mb-1">Клієнтів</div>
          <div className="text-3xl font-bold text-white">{customers.length}</div>
          {customers.length < (count ?? 0) && (
            <div className="text-zinc-500 text-sm mt-0.5">з {count} усього</div>
          )}
        </div>
        <div className="bg-zinc-900 rounded-xl p-3 border border-zinc-800">
          <div className="text-zinc-400 text-xs font-medium uppercase tracking-wide mb-1">Повторних</div>
          <div className="text-3xl font-bold text-emerald-400">{totals.repeat}</div>
          <div className="text-zinc-500 text-sm mt-0.5">
            {customers.length ? Math.round(totals.repeat / customers.length * 100) : 0}%
          </div>
        </div>
        <div className="bg-zinc-900 rounded-xl p-3 border border-zinc-800">
          <div className="text-zinc-400 text-xs font-medium uppercase tracking-wide mb-1">Замовлень</div>
          <div className="text-3xl font-bold text-white">{totals.orders}</div>
        </div>
        <div className="bg-zinc-900 rounded-xl p-3 border border-zinc-800">
          <div className="text-zinc-400 text-xs font-medium uppercase tracking-wide mb-1">Разом</div>
          <div className="text-3xl font-bold text-white">{money(totals.spent)}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <CustomerSearch initial={q} sort={sort} />
        <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1">
          {tab('last', 'За останнім')}
          {tab('orders', 'За кількістю')}
          {tab('spent', 'За сумою')}
        </div>
      </div>

      <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
        <WideScroll>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500 text-xs">
                <th className="w-4" />
                <th className="text-left px-3 py-2">Клієнт</th>
                <th className="text-left px-3 py-2 whitespace-nowrap">Телефон</th>
                <th className="text-left px-3 py-2 whitespace-nowrap">Звідки</th>
                <th className="text-right px-3 py-2 whitespace-nowrap">Замовлень</th>
                <th className="text-right px-3 py-2 whitespace-nowrap">Разом</th>
                <th className="text-right px-3 py-2 whitespace-nowrap">Середній</th>
                <th className="text-left px-3 py-2 whitespace-nowrap">Останнє</th>
                <th className="text-left px-3 py-2">Адреса</th>
              </tr>
            </thead>
            <tbody>
              {customers.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-zinc-500">
                    {q ? 'Нікого не знайшли' : 'Клієнтів ще немає'}
                  </td>
                </tr>
              ) : customers.map(c => <CustomerRow key={c.phone_key} c={c} />)}
            </tbody>
          </table>
        </WideScroll>
      </div>
    </div>
  )
}

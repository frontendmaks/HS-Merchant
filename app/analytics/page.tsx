import { redirect } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentRole, canAccess } from '@/lib/getRole'
import {
  learnCityOblasts, totals, ordersPerDay, popularProducts, popularCategories,
  customers, byRegion, normalizeTitle, operatorStats,
  type OrderRow, type Gazetteer, type OperatorEventRow,
} from '@/lib/analytics'
import gazetteerJson from '@/lib/ua-settlements.json'
import AnalyticsClient from './AnalyticsClient'

export const dynamic = 'force-dynamic'

/** 24k settlements — stays on the server, only resolved values reach the client */
const gazetteer = gazetteerJson as unknown as Gazetteer

// Local date parts — toISOString() would shift midnight back a day in UTC+N
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function defaultRange() {
  const now = new Date()
  const first = new Date(now.getFullYear(), now.getMonth(), 1)
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  return { from: iso(first), to: iso(last) }
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const role = await getCurrentRole()
  if (!canAccess('analytics', role)) redirect('/orders')

  const sp = await searchParams
  const fallback = defaultRange()
  const valid = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null)
  const from = valid(sp.from) ?? fallback.from
  const to = valid(sp.to) ?? fallback.to

  const supabase = createServiceClient()

  const [{ data: orderRows }, { data: productRows }] = await Promise.all([
    supabase
      .from('orders')
      .select('external_id, platform, order_date, customer_name, customer_phone, address, items, total, commission, status, created_at, raw')
      .gte('order_date', from)
      .lte('order_date', to)
      .order('order_date', { ascending: false })
      .limit(20000),
    // Only needed to put order lines into categories
    supabase.from('products').select('name, category_name').limit(5000),
  ])

  const orders = (orderRows ?? []) as OrderRow[]

  const productCategories = new Map<string, string>()
  for (const p of productRows ?? []) {
    if (p.name && p.category_name) {
      productCategories.set(normalizeTitle(p.name), p.category_name)
    }
  }

  // Operator efficiency reads the order journal for the same window
  const { data: orderIdRows } = await supabase
    .from('orders').select('id, total, status')
    .gte('order_date', from).lte('order_date', to).limit(20000)

  const orderIds = (orderIdRows ?? []).map(o => o.id)
  const { data: eventRows } = orderIds.length
    ? await supabase
        .from('order_events')
        .select('order_id, actor_id, actor_name, type, created_at')
        .in('order_id', orderIds)
        .limit(50000)
    : { data: [] }

  // Only operators are measured; managers and admins touch orders too
  const { data: operatorRows } = await supabase
    .from('profiles').select('id').eq('role', 'operator')
  const operatorIds = new Set((operatorRows ?? []).map(r => r.id as string))

  const learned = learnCityOblasts(orders)
  const allCustomers = customers(orders, learned, gazetteer)

  return (
    <AnalyticsClient
      from={from}
      to={to}
      totals={totals(orders)}
      perDay={ordersPerDay(orders, from, to)}
      products={popularProducts(orders)}
      categories={popularCategories(orders, productCategories)}
      customers={allCustomers.slice(0, 20)}
      customerSummary={{
        total: allCustomers.length,
        repeat: allCustomers.filter(c => c.orders > 1).length,
        avgLtv: allCustomers.length
          ? allCustomers.reduce((s, c) => s + c.revenue, 0) / allCustomers.length
          : 0,
        avgOrdersPerCustomer: allCustomers.length
          ? allCustomers.reduce((s, c) => s + c.orders, 0) / allCustomers.length
          : 0,
        avgCadence: (() => {
          const c = allCustomers.map(x => x.cadenceDays).filter((d): d is number => d != null)
          return c.length ? Math.round(c.reduce((a, b) => a + b, 0) / c.length) : null
        })(),
      }}
      regions={byRegion(orders, learned, gazetteer)}
      operators={operatorStats(
        (eventRows ?? []) as OperatorEventRow[],
        (orderIdRows ?? []) as { id: string; total: number | null; status: string | null }[],
        operatorIds,
      )}
    />
  )
}

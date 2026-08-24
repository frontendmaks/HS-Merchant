import { redirect } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentRole, canAccess } from '@/lib/getRole'
import {
  learnCityOblasts, totals, ordersPerDay, popularProducts, popularCategories,
  customers, byRegion, normalizeTitle, type OrderRow,
} from '@/lib/analytics'
import AnalyticsClient from './AnalyticsClient'

export const dynamic = 'force-dynamic'

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ months?: string }>
}) {
  const role = await getCurrentRole()
  if (!canAccess('analytics', role)) redirect('/orders')

  const sp = await searchParams
  const months = Math.min(Math.max(Number(sp.months) || 6, 1), 24)

  const from = new Date()
  from.setMonth(from.getMonth() - months)
  const fromDate = from.toISOString().slice(0, 10)

  const supabase = createServiceClient()

  const [{ data: orderRows }, { data: productRows }] = await Promise.all([
    supabase
      .from('orders')
      .select('external_id, platform, order_date, customer_name, customer_phone, items, total, commission, status, created_at, raw')
      .gte('order_date', fromDate)
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

  const learned = learnCityOblasts(orders)
  const allCustomers = customers(orders)

  return (
    <AnalyticsClient
      months={months}
      totals={totals(orders)}
      perDay={ordersPerDay(orders)}
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
      regions={byRegion(orders, learned)}
    />
  )
}

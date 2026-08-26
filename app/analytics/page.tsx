import { redirect } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentRole, canAccess } from '@/lib/getRole'
import {
  learnCityOblasts, totals, ordersPerDay, popularProducts, popularCategories,
  customers, byRegion, normalizeTitle, operatorStats,
  type OrderRow, type Gazetteer, type OperatorEventRow,
} from '@/lib/analytics'
import gazetteerJson from '@/lib/ua-settlements.json'
import AnalyticsClient, { type Bundle } from './AnalyticsClient'

export const dynamic = 'force-dynamic'

/** 24k settlements — stays on the server, only resolved values reach the client */
const gazetteer = gazetteerJson as unknown as Gazetteer

/** Marketplace slugs as stored on orders.platform */
export const PLATFORMS = ['maudau', 'rozetka'] as const

// Local date parts — toISOString() would shift midnight back a day in UTC+N
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function defaultRange() {
  const now = new Date()
  const first = new Date(now.getFullYear(), now.getMonth(), 1)
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  return { from: iso(first), to: iso(last) }
}

type OrderWithId = OrderRow & { id: string }

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; platform?: string }>
}) {
  const role = await getCurrentRole()
  if (!canAccess('analytics', role)) redirect('/orders')

  const sp = await searchParams
  const fallback = defaultRange()
  const valid = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null)
  const from = valid(sp.from) ?? fallback.from
  const to = valid(sp.to) ?? fallback.to
  const platform = (PLATFORMS as readonly string[]).includes(sp.platform ?? '')
    ? sp.platform! : 'all'

  const supabase = createServiceClient()

  // One pass over the period. Splitting by marketplace happens in memory below,
  // so switching between them costs no round trip at all.
  const [{ data: orderRows }, { data: productRows }, { data: operatorRows }] =
    await Promise.all([
      supabase.from('orders')
        // The raw marketplace payload is large and mostly irrelevant here, so
        // Postgres digs out the three geography fields instead of sending it all
        .select('id, external_id, platform, order_date, customer_name, customer_phone, address, items, total, commission, status, created_at, rz_city:raw->delivery->city, md_city:raw->delivery_address->city->>name, md_postal:raw->delivery_address->warehouse->>postal_code')
        .gte('order_date', from).lte('order_date', to)
        .order('order_date', { ascending: false })
        .limit(20000),
      // Only needed to put order lines into categories
      supabase.from('products').select('name, category_name').limit(5000),
      // Only operators are measured; managers and admins touch orders too
      supabase.from('profiles').select('id').eq('role', 'operator'),
    ])

  const orders = (orderRows ?? []) as unknown as OrderWithId[]
  const operatorIds = new Set((operatorRows ?? []).map(r => r.id as string))

  const productCategories = new Map<string, string>()
  for (const p of productRows ?? []) {
    if (p.name && p.category_name) {
      productCategories.set(normalizeTitle(p.name), p.category_name)
    }
  }

  // Operator efficiency reads the order journal for the same window
  const { data: eventRows } = orders.length
    ? await supabase
        .from('order_events')
        .select('order_id, actor_id, actor_name, type, new_value, created_at')
        .in('order_id', orders.map(o => o.id))
        .limit(50000)
    : { data: [] }

  const events = (eventRows ?? []) as OperatorEventRow[]

  // Efficiency is measured against the roster: a day someone was not due to
  // work is not their time, and time online can only come from the heartbeat
  // trail — profiles.last_seen_at is a single overwritten moment.
  const [{ data: shiftRows }, { data: tickRows }] = await Promise.all([
    supabase.from('work_shifts')
      .select('operator_id, work_date')
      .gte('work_date', from).lte('work_date', to)
      .limit(20000),
    supabase.from('presence_ticks')
      .select('user_id, minute')
      .gte('minute', `${from}T00:00:00Z`).lte('minute', `${to}T23:59:59Z`)
      .limit(200000),
  ])

  const roster = new Map<string, Set<string>>()
  for (const r of shiftRows ?? []) {
    const id = r.operator_id as string
    if (!roster.has(id)) roster.set(id, new Set())
    roster.get(id)!.add(r.work_date as string)
  }

  const ticks = new Map<string, string[]>()
  for (const r of tickRows ?? []) {
    const id = r.user_id as string
    ticks.set(id, [...(ticks.get(id) ?? []), r.minute as string])
  }

  /** Everything the page shows, for one slice of the orders. */
  function bundle(rows: OrderWithId[]): Bundle {
    const learned = learnCityOblasts(rows)
    const all = customers(rows, learned, gazetteer)
    const ids = new Set(rows.map(o => o.id))

    return {
      totals: totals(rows),
      perDay: ordersPerDay(rows, from, to),
      products: popularProducts(rows),
      categories: popularCategories(rows, productCategories),
      customers: all.slice(0, 20),
      customerSummary: {
        total: all.length,
        repeat: all.filter(c => c.orders > 1).length,
        avgLtv: all.length ? all.reduce((s, c) => s + c.revenue, 0) / all.length : 0,
        avgOrdersPerCustomer: all.length
          ? all.reduce((s, c) => s + c.orders, 0) / all.length
          : 0,
        avgCadence: (() => {
          const c = all.map(x => x.cadenceDays).filter((d): d is number => d != null)
          return c.length ? Math.round(c.reduce((a, b) => a + b, 0) / c.length) : null
        })(),
      },
      regions: byRegion(rows, learned, gazetteer),
      operators: operatorStats(
        events.filter(e => ids.has(e.order_id)),
        rows.map(o => ({ id: o.id, total: o.total, status: o.status })),
        operatorIds,
        roster,
        ticks,
      ),
    }
  }

  return (
    <AnalyticsClient
      from={from}
      to={to}
      platform={platform}
      bundles={{
        all: bundle(orders),
        maudau: bundle(orders.filter(o => o.platform === 'maudau')),
        rozetka: bundle(orders.filter(o => o.platform === 'rozetka')),
      }}
    />
  )
}

import { redirect } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
import { getCurrentRole, canAccess } from '@/lib/getRole'
import { isAnalyst } from '@/lib/roles'
import {
  learnCityOblasts, totals, ordersPerDay, popularProducts, popularCategories,
  customers, byRegion, normalizeTitle, operatorStats, cancelStats,
  isCanceled,
  type OrderRow, type Gazetteer, type OperatorEventRow,
} from '@/lib/analytics'
import gazetteerJson from '@/lib/ua-settlements.json'
import AnalyticsClient, { type Bundle } from './AnalyticsClient'
import { placedAtIso } from '@/lib/order-arrival'

export const dynamic = 'force-dynamic'

/** 24k settlements — stays on the server, only resolved values reach the client */
const gazetteer = gazetteerJson as unknown as Gazetteer

/** Marketplace slugs as stored on orders.platform */
export const PLATFORMS = ['maudau', 'rozetka', 'site', 'web', 'phone'] as const

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

/** Shape the client still expects, carrying nothing. */
const EMPTY_CANCELS = {
  total: 0, lost: 0,
  bySide: {
    us: { orders: 0, lost: 0 },
    guest: { orders: 0, lost: 0 },
    unknown: { orders: 0, lost: 0 },
  },
  reasons: [],
  noReason: { orders: 0, lost: 0, bySide: { us: 0, guest: 0, unknown: 0 } },
  beforeJournal: 0, unexplained: 0,
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; platform?: string }>
}) {
  const role = await getCurrentRole()
  if (!canAccess('analytics', role)) redirect('/orders')

  // An analyst reads the market, not the team. What they must not see is not
  // hidden in the browser — it is never computed and never sent.
  const limited = isAnalyst(role)

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
  const [orderRows, productRows, { data: operatorRows }] =
    await Promise.all([
      /**
       * Сторінками, а не одним запитом.
       *
       * PostgREST обрізає будь-яку відповідь на тисячі рядків і мовчить про
       * це — `.limit(20000)` його не стосується. Через це аналітика бачила
       * перші тисячу замовлень періоду, а решта просто не існувала: за
       * жовтень це чотириста замовлень, яких не було ні в доході, ні в
       * клієнтах, ні на карті.
       */
      fetchAllRows(() => supabase.from('orders')
        // The raw marketplace payload is large and mostly irrelevant here, so
        // Postgres digs out the three geography fields instead of sending it all
        .select('id, external_id, platform, order_date, customer_name, customer_phone, address, area, delivery_zone, items, total, commission, status, cancel_reason, created_at, rz_city:raw->delivery->city, md_city:raw->delivery_address->city->>name, md_postal:raw->delivery_address->warehouse->>postal_code, md_placed:raw->>created_at, rz_placed:raw->>created')
        .gte('order_date', from).lte('order_date', to)
        .order('order_date', { ascending: false })),
      // Only needed to put order lines into categories
      // Назви й категорії всіх товарів — щоб рядки замовлень лягли в категорії
      fetchAllRows(() => supabase.from('products').select('name, category_name')),
      // Only operators are measured; managers and admins touch orders too
      supabase.from('profiles').select('id').eq('role', 'operator'),
    ])

  // Полігони зон — для географії доставок наших власних замовлень
  const { data: zoneRows } = await supabase
    .from('delivery_zones').select('code, warehouse, polygon').order('code')

  const orders = (orderRows ?? []) as unknown as OrderWithId[]
  const operatorIds = new Set((operatorRows ?? []).map(r => r.id as string))

  const productCategories = new Map<string, string>()
  for (const p of productRows ?? []) {
    if (p.name && p.category_name) {
      productCategories.set(normalizeTitle(p.name), p.category_name)
    }
  }

  // Operator efficiency reads the order journal for the same window
  /**
   * Журнал подій — частинами по замовленнях.
   *
   * Перелік ідентифікаторів їде в адресі запиту, а вона має межу довжини:
   * півтори тисячі ключів перетворюють запит на «Bad Request», і сторінка
   * просто не відкривається. Тому питаємо пачками по двісті.
   */
  const ids = orders.map(o => o.id)
  const eventRows: OperatorEventRow[] = []

  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    const page = await fetchAllRows(() => supabase
      .from('order_events')
      .select('order_id, actor_id, actor_name, type, new_value, created_at')
      .in('order_id', chunk))
    eventRows.push(...(page as unknown as OperatorEventRow[]))
  }

  const events = eventRows

  // Efficiency is measured against the roster: a day someone was not due to
  // work is not their time, and time online can only come from the heartbeat
  // trail — profiles.last_seen_at is a single overwritten moment.
  // Присутність — хвилина на рядок: за місяць на кількох операторів це
  // десятки тисяч, і тисячний поріг тут ріже найбільше
  const [shiftRows, tickRows] = await Promise.all([
    fetchAllRows(() => supabase.from('work_shifts')
      .select('operator_id, work_date')
      .gte('work_date', from).lte('work_date', to)),
    fetchAllRows(() => supabase.from('presence_ticks')
      .select('user_id, minute')
      .gte('minute', `${from}T00:00:00Z`).lte('minute', `${to}T23:59:59Z`)),
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

  // The heartbeat is newer than the orders, so shifts worked before it exist
  // with no presence data at all — unmeasured, not absent
  // The journal begins the day it was built; a cancellation older than that
  // has no entry to be missing, so absence there is not evidence
  const { data: firstEvent } = await supabase
    .from('order_events').select('created_at').order('created_at').limit(1).maybeSingle()
  const journalFrom = (firstEvent?.created_at as string | undefined)?.slice(0, 10) ?? null

  const { data: firstTick } = await supabase
    .from('presence_ticks').select('minute').order('minute').limit(1).maybeSingle()
  const presenceSince = firstTick?.minute ? new Date(firstTick.minute as string) : null

  /** Everything the page shows, for one slice of the orders. */
  /** Навантаження на кожну зону доставки — для карти. */
  function byZone(rows: OrderWithId[]) {
    const load = new Map<string, { orders: number; revenue: number }>()
    for (const o of rows) {
      const zone = (o as unknown as { delivery_zone?: string | null }).delivery_zone
      if (!zone || isCanceled(o)) continue
      const acc = load.get(zone) ?? { orders: 0, revenue: 0 }
      acc.orders++
      acc.revenue += Number(o.total ?? 0)
      load.set(zone, acc)
    }
    return (zoneRows ?? []).map(z => ({
      code: z.code as string,
      warehouse: z.warehouse as string,
      polygon: (z.polygon as { lat: number; lng: number }[]) ?? [],
      ...(load.get(z.code as string) ?? { orders: 0, revenue: 0 }),
    }))
  }

  /** Скільки замовлень і грошей дав кожен район чи населений пункт. */
  function byArea(rows: OrderWithId[]) {
    const found = new Map<string, { orders: number; revenue: number }>()
    for (const o of rows) {
      const area = (o as unknown as { area?: string | null }).area
      if (!area || isCanceled(o)) continue
      const acc = found.get(area) ?? { orders: 0, revenue: 0 }
      acc.orders++
      acc.revenue += Number(o.total ?? 0)
      found.set(area, acc)
    }
    return [...found].map(([area, v]) => ({ area, ...v }))
      .sort((a, b) => b.orders - a.orders)
  }

  function bundle(rows: OrderWithId[]): Bundle {
    const learned = learnCityOblasts(rows)
    const all = customers(rows, learned, gazetteer)
    const ids = new Set(rows.map(o => o.id))

    return {
      totals: totals(rows),
      perDay: ordersPerDay(rows, from, to),
      products: popularProducts(rows),
      categories: popularCategories(rows, productCategories),
      /**
       * Усі клієнти періоду, а не двадцятка.
       *
       * Двадцятка відповідала на «хто найбільший», але не на «скільки їх і
       * що з рештою» — а саме це й питають, обираючи період.
       */
      customers: all,
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
      // Райони Львова й села — для замовлень, які возить наш склад
      areas: byArea(rows),
      zoneLoad: byZone(rows),
      cancels: limited ? EMPTY_CANCELS : cancelStats(
        rows,
        // An entry with an actor means a person here did it; sync writes none
        new Set(
          events
            .filter(e => ids.has(e.order_id) && e.actor_id
              && (e.type === 'cancel' || e.type === 'cancel_reason'))
            .map(e => e.order_id),
        ),
        journalFrom,
      ),
      operators: limited ? [] : operatorStats(
        events.filter(e => ids.has(e.order_id)),
        rows.map(o => ({
          id: o.id, total: o.total, status: o.status,
          // The marketplace's own stamp, not our sync time — see lib/order-arrival
          arrivedAt: placedAtIso(o.platform, o.md_placed, o.rz_placed) ?? o.created_at,
        })),
        operatorIds,
        roster,
        ticks,
        presenceSince,
      ),
    }
  }

  return (
    <AnalyticsClient
      from={from}
      to={to}
      platform={platform}
      limited={limited}
      bundles={{
        all: bundle(orders),
        maudau: bundle(orders.filter(o => o.platform === 'maudau')),
        rozetka: bundle(orders.filter(o => o.platform === 'rozetka')),
        // Сайт і телефон окремо й разом: у них немає комісії, тож чистий
        // дохід дорівнює виручці, і порівнювати їх із маркетплейсами треба
        // саме так
        site: bundle(orders.filter(o => o.platform === 'site' || o.platform === 'manual')),
        web: bundle(orders.filter(o => o.platform === 'site')),
        phone: bundle(orders.filter(o => o.platform === 'manual')),
      }}
    />
  )
}

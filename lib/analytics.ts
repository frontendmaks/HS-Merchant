// Analytics derived from the orders table. Everything here is pure — the page
// fetches rows once and these functions shape them.

import { isClosed } from '@/lib/requests'

export interface OrderRow {
  external_id: string
  platform: string
  address?: string | null
  order_date: string | null
  customer_name: string | null
  customer_phone: string | null
  items: string | null
  total: number | null
  commission: number | null
  status: string | null
  created_at: string
  /** Geography, pulled straight out of the raw marketplace payload by the
   *  query rather than shipped whole — see the select list in the page. */
  rz_city?: { city_name?: string; name_ua?: string; region_title?: string } | null
  md_city?: string | null
  md_postal?: string | null
}

export const DELIVERED = 'Доставлено'
export const CANCELED = 'Скасовано'

// --- Geography ------------------------------------------------------------

/** First two digits of a Ukrainian postal index identify the oblast. */
const POSTAL_RANGES: [number, number, string][] = [
  [1, 4, 'Київ'],               [7, 9, 'Київська'],
  [10, 13, 'Житомирська'],      [14, 17, 'Чернігівська'],
  [18, 20, 'Черкаська'],        [21, 24, 'Вінницька'],
  [25, 28, 'Кіровоградська'],   [29, 32, 'Хмельницька'],
  [33, 35, 'Рівненська'],       [36, 39, 'Полтавська'],
  [40, 42, 'Сумська'],          [43, 45, 'Волинська'],
  [46, 48, 'Тернопільська'],    [49, 53, 'Дніпропетровська'],
  [54, 57, 'Миколаївська'],     [58, 60, 'Чернівецька'],
  [61, 64, 'Харківська'],       [65, 68, 'Одеська'],
  [69, 72, 'Запорізька'],       [73, 75, 'Херсонська'],
  [76, 78, 'Івано-Франківська'],[79, 82, 'Львівська'],
  [83, 87, 'Донецька'],         [88, 90, 'Закарпатська'],
  [91, 93, 'Луганська'],        [94, 98, 'АР Крим'],
  [99, 99, 'Севастополь'],
]

export const UNKNOWN_OBLAST = 'Не визначено'

/** name -> [oblast, lat, lon], from lib/ua-settlements.json (server only). */
export type Gazetteer = Record<string, [string, number, number]>

/** Apostrophes and spacing vary between sources — match on a normalised key. */
export const placeKey = (s: string) => s
  .toLowerCase()
  .replace(/['’ʼ`´]/g, "'")
  .replace(/[–—]/g, '-')
  .replace(/\s+/g, ' ')
  .trim()

/** Oblast centres are unambiguous, and they carry most of the volume. Trusting
 *  them outright protects against the odd wrong postal index in the source
 *  data — MauDau has a Lviv parcel locker filed under a Dnipro index. */
const OBLAST_CENTRES: Record<string, string> = {
  'Київ': 'Київ',                    'Вінниця': 'Вінницька',
  'Луцьк': 'Волинська',              'Дніпро': 'Дніпропетровська',
  'Донецьк': 'Донецька',             'Житомир': 'Житомирська',
  'Ужгород': 'Закарпатська',         'Запоріжжя': 'Запорізька',
  'Івано-Франківськ': 'Івано-Франківська',
  'Кропивницький': 'Кіровоградська', 'Луганськ': 'Луганська',
  'Львів': 'Львівська',              'Миколаїв': 'Миколаївська',
  'Одеса': 'Одеська',                'Полтава': 'Полтавська',
  'Рівне': 'Рівненська',             'Суми': 'Сумська',
  'Тернопіль': 'Тернопільська',      'Харків': 'Харківська',
  'Херсон': 'Херсонська',            'Хмельницький': 'Хмельницька',
  'Черкаси': 'Черкаська',            'Чернівці': 'Чернівецька',
  'Чернігів': 'Чернігівська',        'Сімферополь': 'АР Крим',
  'Севастополь': 'Севастополь',
}

function oblastFromPostal(postal: string | null | undefined): string | null {
  if (!postal) return null
  const n = parseInt(String(postal).slice(0, 2), 10)
  if (Number.isNaN(n)) return null
  return POSTAL_RANGES.find(([lo, hi]) => n >= lo && n <= hi)?.[2] ?? null
}

export const cityOf = (o: OrderRow): string | null =>
  o.platform === 'rozetka'
    ? (o.rz_city?.city_name ?? o.rz_city?.name_ua ?? null)
    : (o.md_city ?? null)

/** Rozetka states the region outright; MauDau does not, so it comes from the
 *  branch's postal index. Courier orders have no branch — for those we reuse
 *  the oblast already learned for that city from other orders. */
function directOblast(o: OrderRow): string | null {
  if (o.platform === 'rozetka') {
    const t = o.rz_city?.region_title
    return typeof t === 'string' && t.trim() ? t.trim() : null
  }
  return oblastFromPostal(o.md_postal)
}

/** city -> oblast, learned from the orders that state it directly.
 *  Majority vote rather than first-seen, so one bad index cannot mislabel a
 *  city that every other order places correctly. */
export function learnCityOblasts(orders: OrderRow[]): Map<string, string> {
  const votes = new Map<string, Map<string, number>>()
  for (const o of orders) {
    const city = cityOf(o)
    const oblast = directOblast(o)
    if (!city || !oblast) continue
    const tally = votes.get(city) ?? new Map<string, number>()
    tally.set(oblast, (tally.get(oblast) ?? 0) + 1)
    votes.set(city, tally)
  }

  const map = new Map<string, string>()
  for (const [city, tally] of votes) {
    const winner = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]
    if (winner) map.set(city, winner[0])
  }
  return map
}

export function resolveOblast(
  o: OrderRow,
  learned: Map<string, string>,
  gazetteer?: Gazetteer,
): string {
  const city = cityOf(o)
  if (city && OBLAST_CENTRES[city]) return OBLAST_CENTRES[city]

  const direct = directOblast(o)
  if (direct) return direct

  // Courier orders carry no branch, so fall back to the settlement directory
  const g = city && gazetteer?.[placeKey(city)]
  if (g) return g[0]

  return (city ? learned.get(city) : null) || UNKNOWN_OBLAST
}

export const cityCoords = (city: string, gazetteer?: Gazetteer):
  { lat: number; lon: number } | null => {
  const g = gazetteer?.[placeKey(city)]
  return g ? { lat: g[1], lon: g[2] } : null
}

// --- Helpers --------------------------------------------------------------

const num = (v: number | null | undefined) => Number(v ?? 0)
export const isDelivered = (o: OrderRow) => o.status === DELIVERED
export const isCanceled = (o: OrderRow) => o.status === CANCELED

/** Item lines look like "Ковбаса «Царська» в/г, 300 г, 2 шт x 71 грн". */
export interface ParsedItem { title: string; qty: number; price: number }

export function parseItems(items: string | null): ParsedItem[] {
  if (!items) return []
  return items.split('\n').map(line => {
    const m = line.match(/^(.*),\s*(\d+(?:[.,]\d+)?)\s*шт\s*x\s*([\d.,]+)\s*грн\s*$/i)
    if (!m) return null
    return {
      title: m[1].trim(),
      qty: parseFloat(m[2].replace(',', '.')) || 1,
      price: parseFloat(m[3].replace(',', '.')) || 0,
    }
  }).filter((x): x is ParsedItem => x !== null)
}

// --- Aggregations ---------------------------------------------------------

export interface Totals {
  orders: number
  delivered: number
  canceled: number
  inFlight: number
  revenue: number
  commission: number
  net: number
  avgCheck: number
  avgCheckAll: number
}

export function totals(orders: OrderRow[]): Totals {
  const delivered = orders.filter(isDelivered)
  const canceled = orders.filter(isCanceled)
  const revenue = delivered.reduce((s, o) => s + num(o.total), 0)
  const commission = delivered.reduce((s, o) => s + num(o.commission), 0)
  const billable = orders.filter(o => !isCanceled(o))
  return {
    orders: orders.length,
    delivered: delivered.length,
    canceled: canceled.length,
    inFlight: orders.length - delivered.length - canceled.length,
    revenue,
    commission,
    net: revenue - commission,
    avgCheck: delivered.length ? revenue / delivered.length : 0,
    avgCheckAll: billable.length
      ? billable.reduce((s, o) => s + num(o.total), 0) / billable.length
      : 0,
  }
}

export interface DayBucket {
  date: string
  count: number
  /** What customers ordered that day, cancellations excluded */
  ordered: number
  /** Of that, what actually got delivered */
  revenue: number
}

/** One bucket per calendar day in [from, to] — days without orders are kept as
 *  zeros so the chart reads as a timeline instead of a row of equal bars. */
export function ordersPerDay(orders: OrderRow[], from?: string, to?: string): DayBucket[] {
  const map = new Map<string, DayBucket>()

  const blank = (date: string): DayBucket => ({ date, count: 0, ordered: 0, revenue: 0 })

  if (from && to) {
    const cursor = new Date(from + 'T00:00:00')
    const end = new Date(to + 'T00:00:00')
    while (cursor <= end) {
      const y = cursor.getFullYear()
      const m = String(cursor.getMonth() + 1).padStart(2, '0')
      const d = String(cursor.getDate()).padStart(2, '0')
      map.set(`${y}-${m}-${d}`, blank(`${y}-${m}-${d}`))
      cursor.setDate(cursor.getDate() + 1)
    }
  }

  for (const o of orders) {
    if (!o.order_date) continue
    const b = map.get(o.order_date) ?? blank(o.order_date)
    b.count++
    if (!isCanceled(o)) b.ordered += num(o.total)
    if (isDelivered(o)) b.revenue += num(o.total)
    map.set(o.order_date, b)
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export interface ProductStat {
  title: string
  qty: number
  revenue: number
  orders: number
}

export function popularProducts(orders: OrderRow[], limit = 15): ProductStat[] {
  const map = new Map<string, ProductStat>()
  for (const o of orders) {
    if (isCanceled(o)) continue
    for (const it of parseItems(o.items)) {
      // Source titles sometimes carry double spaces — same product otherwise
      const title = it.title.replace(/\s+/g, ' ').trim()
      const s = map.get(title) ?? { title, qty: 0, revenue: 0, orders: 0 }
      s.qty += it.qty
      s.revenue += it.qty * it.price
      s.orders++
      map.set(title, s)
    }
  }
  return [...map.values()].sort((a, b) => b.qty - a.qty).slice(0, limit)
}

export interface CategoryStat extends ProductStat { category: string }

/** Product titles in orders are free text, so categories come from matching
 *  them against the catalogue by name. Unmatched items are grouped as "Інші". */
export function popularCategories(
  orders: OrderRow[],
  productCategories: Map<string, string>,
  limit = 12,
): CategoryStat[] {
  const map = new Map<string, CategoryStat>()
  for (const o of orders) {
    if (isCanceled(o)) continue
    for (const it of parseItems(o.items)) {
      const cat = productCategories.get(normalizeTitle(it.title)) ?? 'Інші'
      const s = map.get(cat) ?? { category: cat, title: cat, qty: 0, revenue: 0, orders: 0 }
      s.qty += it.qty
      s.revenue += it.qty * it.price
      s.orders++
      map.set(cat, s)
    }
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue).slice(0, limit)
}

/** Order lines carry the weight suffix the feed adds, the catalogue does not. */
export function normalizeTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/,\s*\d+(?:[.,]\d+)?\s*(?:кг|г|мл|л)\s*$/i, '')
    .replace(/["'«»“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface CustomerStat {
  key: string
  name: string
  phone: string | null
  /** "Область, вулиця…" from the customer's most recent order */
  address: string | null
  orders: number
  delivered: number
  revenue: number
  firstDate: string | null
  lastDate: string | null
  /** Average days between consecutive orders, null for one-off buyers */
  cadenceDays: number | null
}

export function customers(
  orders: OrderRow[],
  learned?: Map<string, string>,
  gazetteer?: Gazetteer,
): CustomerStat[] {
  const map = new Map<string, { rows: OrderRow[] }>()
  for (const o of orders) {
    // Phone identifies a person far better than a typed-in name
    const key = (o.customer_phone || o.customer_name || '').trim()
    if (!key) continue
    const e = map.get(key) ?? { rows: [] }
    e.rows.push(o)
    map.set(key, e)
  }

  return [...map.entries()].map(([key, { rows }]) => {
    const dates = rows.map(r => r.order_date).filter((d): d is string => !!d).sort()
    let cadence: number | null = null
    if (dates.length > 1) {
      const first = new Date(dates[0]).getTime()
      const last = new Date(dates[dates.length - 1]).getTime()
      cadence = Math.round((last - first) / 86_400_000 / (dates.length - 1))
    }
    const delivered = rows.filter(isDelivered)

    // Most recent order decides the address we show
    const latest = [...rows].sort((a, b) =>
      (b.order_date ?? '').localeCompare(a.order_date ?? ''))[0]
    const oblast = latest && learned
      ? resolveOblast(latest, learned, gazetteer)
      : null
    const rest = latest?.address?.trim() || null
    const address = rest
      ? (oblast && oblast !== UNKNOWN_OBLAST ? `${oblast}, ${rest}` : rest)
      : (oblast && oblast !== UNKNOWN_OBLAST ? oblast : null)

    return {
      key,
      name: rows.find(r => r.customer_name)?.customer_name ?? key,
      phone: rows.find(r => r.customer_phone)?.customer_phone ?? null,
      address,
      orders: rows.length,
      delivered: delivered.length,
      revenue: delivered.reduce((s, o) => s + num(o.total), 0),
      firstDate: dates[0] ?? null,
      lastDate: dates[dates.length - 1] ?? null,
      cadenceDays: cadence,
    }
  }).sort((a, b) => b.revenue - a.revenue)
}

export interface RegionCity {
  city: string
  orders: number
  revenue: number
  /** Null when the settlement is not in the directory — no pin is drawn */
  lat: number | null
  lon: number | null
}

export interface RegionStat {
  oblast: string
  orders: number
  delivered: number
  canceled: number
  inFlight: number
  revenue: number
  byPlatform: Record<string, number>
  cities: RegionCity[]
  products: ProductStat[]
  /** Average days between repeat orders from this oblast */
  cadenceDays: number | null
}

export function byRegion(
  orders: OrderRow[],
  learned: Map<string, string>,
  gazetteer?: Gazetteer,
): RegionStat[] {
  type CityStat = { city: string; orders: number; revenue: number }
  const map = new Map<string, { rows: OrderRow[]; cities: Map<string, CityStat> }>()

  for (const o of orders) {
    const oblast = resolveOblast(o, learned, gazetteer)
    const e = map.get(oblast)
      ?? { rows: [] as OrderRow[], cities: new Map<string, CityStat>() }
    e.rows.push(o)
    const city = cityOf(o) ?? '—'
    const c = e.cities.get(city) ?? { city, orders: 0, revenue: 0 }
    c.orders++
    if (isDelivered(o)) c.revenue += num(o.total)
    e.cities.set(city, c)
    map.set(oblast, e)
  }

  return [...map.entries()].map(([oblast, { rows, cities }]) => {
    const byPlatform: Record<string, number> = {}
    for (const r of rows) byPlatform[r.platform] = (byPlatform[r.platform] ?? 0) + 1

    // How often this oblast reorders, averaged over its repeat customers
    const cadences = customers(rows)
      .map(c => c.cadenceDays)
      .filter((d): d is number => d != null)
    const cadenceDays = cadences.length
      ? Math.round(cadences.reduce((a, b) => a + b, 0) / cadences.length)
      : null

    const delivered = rows.filter(isDelivered).length
    const canceled = rows.filter(isCanceled).length

    return {
      oblast,
      orders: rows.length,
      delivered,
      canceled,
      inFlight: rows.length - delivered - canceled,
      revenue: rows.filter(isDelivered).reduce((s, o) => s + num(o.total), 0),
      byPlatform,
      cities: [...cities.values()]
        .sort((a, b) => b.orders - a.orders)
        .map(c => ({ ...c, ...(cityCoords(c.city, gazetteer) ?? { lat: null, lon: null }) })),
      products: popularProducts(rows, 8),
      cadenceDays,
    }
  }).sort((a, b) => b.orders - a.orders)
}

export { isClosed }


// --- Operator efficiency ----------------------------------------------------

import {
  SHIFT_MINUTES, businessMinutes, localDate, onlineMinutes,
  WORK_END_HOUR, WORK_START_HOUR,
} from '@/lib/work-hours'

export interface OperatorEventRow {
  order_id: string
  actor_id: string | null
  actor_name: string | null
  type: string
  created_at: string
}

export interface OperatorStat {
  id: string
  name: string
  /** Orders this person touched at least once */
  orders: number
  /** Individual actions logged */
  actions: number
  /** Value of the orders they handled */
  revenue: number
  /** Average value of one handled order */
  avgOrder: number
  delivered: number
  canceled: number
  /** Waybills created */
  ttn: number
  /** How the actions split by kind */
  byType: Record<string, number>
  /** Median working minutes from an order arriving to this person's first action */
  reactionMins: number | null
  /** Median working minutes from their first to their last action on an order */
  handlingMins: number | null
  /** Share of orders answered within the same shift */
  sameShiftPct: number | null

  // --- measured against the roster --------------------------------------
  /** Days they were rostered inside the period */
  shifts: number
  /** Minutes those shifts add up to */
  scheduledMins: number
  /** Minutes the panel was actually open during them */
  onlineMins: number
  /** Online as a share of rostered time */
  presencePct: number | null
  /** Orders handled per hour actually online */
  ordersPerHour: number | null
  /** Actions taken outside any rostered shift — not counted in the durations */
  offShiftActions: number
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

/**
 * Efficiency per operator, derived from the order journal.
 *
 * Only people whose role is `operator` are counted — managers and admins touch
 * orders too, but they are not measured here. Events with no actor came from
 * the marketplace and belong to nobody.
 *
 * Durations count working time only: an order arriving at 22:00 and answered at
 * 09:30 is ninety minutes of waiting, not eleven and a half hours.
 */
export function operatorStats(
  events: OperatorEventRow[],
  orders: { id: string; total: number | null; status: string | null }[],
  operatorIds: Set<string>,
  /** Rostered days per operator, and the heartbeat trail — without these the
   *  durations would charge people for hours they were not due to work. */
  roster: Map<string, Set<string>> = new Map(),
  ticks: Map<string, string[]> = new Map(),
): OperatorStat[] {
  const orderById = new Map(orders.map(o => [o.id, o]))
  const byActor = new Map<string, { name: string; rows: OperatorEventRow[] }>()

  // Arrival time per order, taken from the actorless "created" entry
  const arrivalOf = new Map<string, string>()
  for (const e of events) {
    if (e.type === 'created' && !arrivalOf.has(e.order_id)) arrivalOf.set(e.order_id, e.created_at)
  }

  for (const e of events) {
    if (!e.actor_id || !operatorIds.has(e.actor_id)) continue
    const entry = byActor.get(e.actor_id) ?? { name: e.actor_name?.trim() || 'Оператор', rows: [] }
    if (e.actor_name?.trim()) entry.name = e.actor_name.trim()
    entry.rows.push(e)
    byActor.set(e.actor_id, entry)
  }

  // Anyone rostered belongs in the table even if they logged nothing — an
  // operator who worked a shift and touched no order is a fact worth seeing,
  // not a missing row.
  for (const id of roster.keys()) {
    if (operatorIds.has(id) && !byActor.has(id)) byActor.set(id, { name: 'Оператор', rows: [] })
  }

  return [...byActor.entries()].map(([id, { name, rows }]) => {
    const workDates = roster.get(id) ?? new Set<string>()
    const measured = workDates.size > 0
    const perOrder = new Map<string, OperatorEventRow[]>()
    for (const r of rows) perOrder.set(r.order_id, [...(perOrder.get(r.order_id) ?? []), r])

    const reaction: number[] = []
    const handling: number[] = []
    const byType: Record<string, number> = {}
    let revenue = 0, delivered = 0, canceled = 0, ttn = 0, sameShift = 0, withArrival = 0
    let offShiftActions = 0

    for (const r of rows) {
      byType[r.type] = (byType[r.type] ?? 0) + 1
      if (r.type === 'ttn') ttn++
      if (measured && !workDates.has(localDate(new Date(r.created_at)))) offShiftActions++
    }

    for (const [orderId, evs] of perOrder) {
      const order = orderById.get(orderId)
      if (order) {
        revenue += num(order.total)
        if (order.status === 'Доставлено') delivered++
        if (order.status === 'Скасовано') canceled++
      }

      // Durations are built from work done on shift. An action taken on a day
      // off still counts as an action, but letting it bound the window would
      // charge a whole extra shift to an order that was finished long before.
      const onShift = measured
        ? evs.filter(e => workDates.has(localDate(new Date(e.created_at))))
        : evs
      if (!onShift.length) continue

      const sorted = [...onShift].sort((a, b) => a.created_at.localeCompare(b.created_at))
      const first = sorted[0].created_at
      const last = sorted[sorted.length - 1].created_at

      const arrival = arrivalOf.get(orderId)
      if (arrival) {
        const mins = businessMinutes(arrival, first, measured ? { workDates } : {})
        if (mins != null) {
          reaction.push(mins)
          withArrival++
          // One shift is nine hours; answering inside that is same-day service
          if (mins <= (WORK_END_HOUR - WORK_START_HOUR) * 60) sameShift++
        }
      }

      if (sorted.length > 1) {
        const mins = businessMinutes(first, last, measured ? { workDates } : {})
        if (mins != null) handling.push(mins)
      }
    }

    const scheduledMins = workDates.size * SHIFT_MINUTES
    const onlineMins = onlineMinutes(ticks.get(id) ?? [], workDates)
    const onlineHours = onlineMins / 60

    return {
      id,
      name,
      orders: perOrder.size,
      actions: rows.length,
      revenue: Math.round(revenue * 100) / 100,
      avgOrder: perOrder.size ? Math.round((revenue / perOrder.size) * 100) / 100 : 0,
      delivered,
      canceled,
      ttn,
      byType,
      reactionMins: median(reaction),
      handlingMins: median(handling),
      sameShiftPct: withArrival ? Math.round((sameShift / withArrival) * 100) : null,
      shifts: workDates.size,
      scheduledMins,
      onlineMins,
      // Presence can exceed the roster if someone works beyond their hours;
      // the honest figure is the ratio, not a capped one
      presencePct: scheduledMins ? Math.round((onlineMins / scheduledMins) * 100) : null,
      ordersPerHour: onlineHours >= 0.5
        ? Math.round((perOrder.size / onlineHours) * 10) / 10
        : null,
      offShiftActions,
    }
  }).sort((a, b) => b.orders - a.orders)
}



// --- Operator efficiency ----------------------------------------------------

export interface OperatorEventRow {
  order_id: string
  actor_id: string | null
  actor_name: string | null
  type: string
  created_at: string
}

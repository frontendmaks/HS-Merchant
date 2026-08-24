// Analytics derived from the orders table. Everything here is pure — the page
// fetches rows once and these functions shape them.

import { isClosed } from '@/lib/requests'

export interface OrderRow {
  external_id: string
  platform: string
  order_date: string | null
  customer_name: string | null
  customer_phone: string | null
  items: string | null
  total: number | null
  commission: number | null
  status: string | null
  created_at: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw: any
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
    ? (o.raw?.delivery?.city?.city_name ?? o.raw?.delivery?.city?.name_ua ?? null)
    : (o.raw?.delivery_address?.city?.name ?? null)

/** Rozetka states the region outright; MauDau does not, so it comes from the
 *  branch's postal index. Courier orders have no branch — for those we reuse
 *  the oblast already learned for that city from other orders. */
function directOblast(o: OrderRow): string | null {
  if (o.platform === 'rozetka') {
    const t = o.raw?.delivery?.city?.region_title
    return typeof t === 'string' && t.trim() ? t.trim() : null
  }
  return oblastFromPostal(o.raw?.delivery_address?.warehouse?.postal_code)
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

export function resolveOblast(o: OrderRow, learned: Map<string, string>): string {
  const city = cityOf(o)
  if (city && OBLAST_CENTRES[city]) return OBLAST_CENTRES[city]
  return directOblast(o) || (city ? learned.get(city) : null) || UNKNOWN_OBLAST
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

export interface DayBucket { date: string; count: number; revenue: number }

export function ordersPerDay(orders: OrderRow[]): DayBucket[] {
  const map = new Map<string, DayBucket>()
  for (const o of orders) {
    if (!o.order_date) continue
    const b = map.get(o.order_date) ?? { date: o.order_date, count: 0, revenue: 0 }
    b.count++
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
  orders: number
  delivered: number
  revenue: number
  firstDate: string | null
  lastDate: string | null
  /** Average days between consecutive orders, null for one-off buyers */
  cadenceDays: number | null
}

export function customers(orders: OrderRow[]): CustomerStat[] {
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
    return {
      key,
      name: rows.find(r => r.customer_name)?.customer_name ?? key,
      phone: rows.find(r => r.customer_phone)?.customer_phone ?? null,
      orders: rows.length,
      delivered: delivered.length,
      revenue: delivered.reduce((s, o) => s + num(o.total), 0),
      firstDate: dates[0] ?? null,
      lastDate: dates[dates.length - 1] ?? null,
      cadenceDays: cadence,
    }
  }).sort((a, b) => b.revenue - a.revenue)
}

export interface RegionStat {
  oblast: string
  orders: number
  delivered: number
  canceled: number
  revenue: number
  byPlatform: Record<string, number>
  cities: { city: string; orders: number; revenue: number }[]
  /** Median days between repeat orders from this oblast */
  cadenceDays: number | null
}

export function byRegion(orders: OrderRow[], learned: Map<string, string>): RegionStat[] {
  type CityStat = { city: string; orders: number; revenue: number }
  const map = new Map<string, { rows: OrderRow[]; cities: Map<string, CityStat> }>()

  for (const o of orders) {
    const oblast = resolveOblast(o, learned)
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

    return {
      oblast,
      orders: rows.length,
      delivered: rows.filter(isDelivered).length,
      canceled: rows.filter(isCanceled).length,
      revenue: rows.filter(isDelivered).reduce((s, o) => s + num(o.total), 0),
      byPlatform,
      cities: [...cities.values()].sort((a, b) => b.orders - a.orders),
      cadenceDays,
    }
  }).sort((a, b) => b.orders - a.orders)
}

export { isClosed }

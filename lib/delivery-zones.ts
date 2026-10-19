/**
 * Який склад везе замовлення за цією адресою.
 *
 * Сайт тримає карту зон доставки у вигляді полігонів, і саме від неї
 * відштовхується вся доставка. Ми беремо ту саму карту — інакше склад у
 * Мерчанті й склад на сайті рано чи пізно розійдуться, і дізнаємось ми про це
 * з телефонного дзвінка розгубленого комірника.
 */
import { createServiceClient } from '@/lib/supabase/service'

type Service = ReturnType<typeof createServiceClient>

export const ZONES_URL =
  'https://halytska-svizhyna.ua/wp-content/uploads/2026/06/zona-dostavky-1.json'

export interface Point { lat: number; lng: number }

export interface ZoneHit {
  zone: string
  warehouse: string
}

/**
 * Чи лежить точка всередині полігона.
 *
 * Промінь праворуч від точки: непарна кількість перетинів межі означає, що
 * точка всередині. Працює і для опуклих, і для вигнутих зон — а зони на цій
 * карті вигнуті, вони обходять річку й залізницю.
 */
export function insidePolygon(p: Point, poly: Point[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    const straddles = (a.lat > p.lat) !== (b.lat > p.lat)
    if (!straddles) continue
    const x = ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng
    if (p.lng < x) inside = !inside
  }
  return inside
}

/** Тягне карту з сайту й оновлює нашу копію. */
export async function refreshZones(service: Service): Promise<{ updated: number; error?: string }> {
  try {
    const res = await fetch(ZONES_URL, { signal: AbortSignal.timeout(20_000) })
    if (!res.ok) return { updated: 0, error: `Сайт відповів ${res.status}` }

    const data = await res.json() as {
      areas?: Record<string, { color?: string; coordinates?: Point[] }>
    }
    const areas = data.areas ?? {}
    let updated = 0

    for (const [code, area] of Object.entries(areas)) {
      const polygon = (area.coordinates ?? []).filter(
        p => Number.isFinite(p?.lat) && Number.isFinite(p?.lng))
      if (polygon.length < 3) continue

      await service.from('delivery_zones').update({
        polygon, color: area.color ?? null, updated_at: new Date().toISOString(),
      }).eq('code', code)
      updated++
    }
    return { updated }
  } catch (e) {
    return { updated: 0, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Зона й склад за координатами.
 *
 * Зони на карті подекуди перекриваються — на межі міста їх малювали руками.
 * Коли точка потрапляє в кілька, береться перша за порядком: він відповідає
 * порядку в налаштуваннях сайту, тож вибір збігається з тим, що зробив би сайт.
 */
interface ZoneRow { code: string; warehouse: string; polygon: Point[] }

/** Зони з бази — вісім полігонів, які перевіряються по кілька разів на адресу,
 *  тож читаються один раз і далі перебираються в пам'яті. */
export async function loadZones(service: Service): Promise<ZoneRow[]> {
  const { data } = await service
    .from('delivery_zones').select('code, warehouse, polygon').order('code')

  return (data ?? []).map(z => ({
    code: z.code as string,
    warehouse: z.warehouse as string,
    polygon: (z.polygon as Point[]) ?? [],
  }))
}

export function zoneAt(point: Point, zones: ZoneRow[]): ZoneHit | null {
  for (const z of zones) {
    if (z.polygon.length >= 3 && insidePolygon(point, z.polygon)) {
      return { zone: z.code, warehouse: z.warehouse }
    }
  }
  return null
}

export async function zoneForPoint(
  service: Service,
  point: Point,
): Promise<ZoneHit | null> {
  return zoneAt(point, await loadZones(service))
}

const GEOCODER_UA =
  'HS-Merchant/1.0 (order intake; https://hs-merchant.vercel.app)'

export interface Geocoded extends Point { display_name: string | null }

/**
 * Координати адреси.
 *
 * Nominatim безкоштовний і просить не частіше одного запиту на секунду — для
 * ручних замовлень цього вдосталь. Результат кешується: та сама адреса
 * питається один раз, і повторне відкриття форми нікого не турбує.
 */
async function ask(query: string): Promise<Geocoded | null> {
  try {
    const url = 'https://nominatim.openstreetmap.org/search'
      + '?format=json&limit=1&countrycodes=ua&accept-language=uk&q=' + encodeURIComponent(query)
    const res = await fetch(url, {
      headers: { 'User-Agent': GEOCODER_UA },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return null
    const hits = await res.json() as { lat: string; lon: string; display_name: string }[]
    const first = hits[0]
    return first
      ? { lat: Number(first.lat), lng: Number(first.lon), display_name: first.display_name }
      : null
  } catch {
    return null
  }
}

/**
 * Адреса з сайту — у вигляді, який розуміє геокодер.
 *
 * Сайт складає її з полів форми й лишає по собі сліди цієї форми:
 * «м.Львів, Львів, вулиця Трускавецька, буд. № 2, під. 3, пов. 5, кв. 42».
 * Геокодеру з цього потрібні три речі — місто, вулиця, будинок; решта для
 * нього шум, через який він не знаходить нічого.
 */
export function tidyAddress(raw: string): string {
  const parts = raw
    .replace(/\\'/g, '’')
    .split(',')
    .map(p => p.trim())
    .filter(Boolean)
    /**
     * Під'їзд, поверх, квартира й домофон адресу не уточнюють — будинок
     * один і той самий.
     *
     * Межа слова тут не `\b`: у JavaScript вона рахує літерами лише
     * латиницю, тож між пробілом і «під» межі немає, і правило мовчки не
     * спрацьовує. Перевіряємо натомість, що далі не літера.
     */
    .filter(p => !/^(під|підʼ?їзд|пов|поверх|кв|квартира|домофон|корп|корпус|офіс)(?![\p{L}])/iu
      .test(p))
    .map(p => p
      .replace(/^м\.?\s*/i, '')
      .replace(/буд(?![\p{L}])\.?\s*№?\s*/giu, '')
      .replace(/\s+/g, ' ')
      .trim())
    .filter(Boolean)

  // «м.Львів, Львів» — те саме місто двічі, бо в одному полі його вписали, а
  // друге підставилось зі списку
  const unique: string[] = []
  for (const p of parts) {
    if (!unique.some(u => u.toLowerCase() === p.toLowerCase())) unique.push(p)
  }
  return unique.join(', ')
}

/**
 * Як саме питати геокодер про цю адресу.
 *
 * «Петлюри 14» без міста спершу уточнювалось як «Львівська область» — і
 * знаходило Дрогобич, бо вулиця Петлюри є і там. Місто важливіше за область:
 * ми возимо по Львову й околицях, тож питаємо спершу про Львів.
 */
function queryVariants(address: string): string[] {
  const a = tidyAddress(address)
  const mentionsCity = /львів|брюховичі|винники|сокільники|зимна вода|рудно|малехів|солонка|пустомити|сихів/i.test(a)

  return [...new Set([
    mentionsCity ? a : `Львів, ${a}`,
    a,
    `Львівська область, ${a}`,
  ])]
}

/**
 * Версія логіки пошуку адреси.
 *
 * Піднімається щоразу, коли змінюється те, як складається запит до геокодера:
 * записи кешу з нижчою версією перепитуються, замість того щоб вічно
 * повертати координати, знайдені за старим правилом.
 */
const RESOLVER_VERSION = 2

async function remember(
  service: Service,
  query: string,
  point: Geocoded | null,
): Promise<void> {
  await service.from('geocode_cache').upsert({
    query,
    lat: point?.lat ?? null,
    lng: point?.lng ?? null,
    display_name: point?.display_name ?? null,
    resolver: RESOLVER_VERSION,
  }, { onConflict: 'query' })
}

export async function geocode(
  service: Service,
  address: string,
): Promise<Geocoded | null> {
  const query = address.trim()
  if (query.length < 5) return null

  const { data: cached } = await service
    .from('geocode_cache').select('lat, lng, display_name, resolver').eq('query', query).maybeSingle()

  // Кеш старої версії не використовуємо: він пам'ятає відповідь, а не спосіб,
  // яким її отримали, і після зміни способу тихо скасовував би виправлення —
  // «Петлюри 14» так і лишалося б у Дрогобичі, вже знайденому раніше.
  if (cached && Number(cached.resolver ?? 1) >= RESOLVER_VERSION) {
    return cached.lat == null ? null : {
      lat: Number(cached.lat), lng: Number(cached.lng),
      display_name: cached.display_name as string,
    }
  }

  /**
   * Беремо перший варіант, що потрапляє в зону доставки.
   *
   * Сама по собі «знайдена точка» ще нічого не означає — геокодер майже
   * завжди щось знаходить. Значення має точка, куди ми реально возимо, тож
   * саме це й перевіряємо, перш ніж спинитись.
   */
  let firstHit: Geocoded | null = null
  const zones = await loadZones(service)

  for (const variant of queryVariants(query)) {
    const point = await ask(variant)
    if (!point) continue
    firstHit ??= point

    if (zoneAt(point, zones)) {
      await remember(service, query, point)
      return point
    }
    // Чужий сервіс просить не частіше разу на секунду
    await new Promise(r => setTimeout(r, 1100))
  }

  // Жоден варіант не потрапив у зону — лишаємо перший знайдений, щоб
  // оператор бачив, що саме розпізналось, і міг виправити адресу
  if (firstHit) {
    await remember(service, query, firstHit)
    return firstHit
  }

  await remember(service, query, null)
  return null
}

export interface AddressResolution {
  point: Geocoded | null
  zone: string | null
  warehouse: string | null
  /** Чому складу немає — щоб оператор бачив причину, а не порожнє поле */
  note: string | null
}

export async function resolveAddress(
  service: Service,
  address: string,
): Promise<AddressResolution> {
  const point = await geocode(service, address)
  if (!point) {
    return {
      point: null, zone: null, warehouse: null,
      note: 'Адресу не вдалося розпізнати — оберіть склад вручну',
    }
  }

  const hit = await zoneForPoint(service, point)
  if (!hit) {
    return {
      point, zone: null, warehouse: null,
      note: 'Адреса поза зонами доставки — оберіть склад вручну',
    }
  }

  return { point, zone: hit.zone, warehouse: hit.warehouse, note: null }
}

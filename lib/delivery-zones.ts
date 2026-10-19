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
export async function zoneForPoint(
  service: Service,
  point: Point,
): Promise<ZoneHit | null> {
  const { data: zones } = await service
    .from('delivery_zones').select('code, warehouse, polygon').order('code')

  for (const z of zones ?? []) {
    const poly = (z.polygon as Point[]) ?? []
    if (poly.length >= 3 && insidePolygon(point, poly)) {
      return { zone: z.code as string, warehouse: z.warehouse as string }
    }
  }
  return null
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
export async function geocode(
  service: Service,
  address: string,
): Promise<Geocoded | null> {
  const query = address.trim()
  if (query.length < 5) return null

  const { data: cached } = await service
    .from('geocode_cache').select('lat, lng, display_name').eq('query', query).maybeSingle()

  if (cached?.lat != null) {
    return {
      lat: Number(cached.lat), lng: Number(cached.lng),
      display_name: cached.display_name as string,
    }
  }

  try {
    // Львівщина — підказка геокодеру, бо «Городоцька» є не лише у Львові
    const url = 'https://nominatim.openstreetmap.org/search'
      + '?format=json&limit=1&countrycodes=ua&accept-language=uk&q='
      + encodeURIComponent(query.includes('Львів') ? query : `Львівська область, ${query}`)

    const res = await fetch(url, {
      headers: { 'User-Agent': GEOCODER_UA },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return null

    const hits = await res.json() as { lat: string; lon: string; display_name: string }[]
    const first = hits[0]
    if (!first) {
      // Негативний результат теж кешуємо: та сама незнайома адреса не має
      // ганяти нас до геокодера щоразу, як оператор перечитує форму
      await service.from('geocode_cache')
        .upsert({ query, lat: null, lng: null, display_name: null }, { onConflict: 'query' })
      return null
    }

    const point = {
      lat: Number(first.lat), lng: Number(first.lon),
      display_name: first.display_name as string,
    }
    await service.from('geocode_cache').upsert({ query, ...point }, { onConflict: 'query' })
    return point
  } catch {
    return null
  }
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

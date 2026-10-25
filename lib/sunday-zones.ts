/**
 * Недільна карта доставки.
 *
 * У будні возять сім складів, у неділю — чотири: решта не працює, і їхні
 * вулиці розбирають між собою ті, що відкриті. Межі при цьому інші, тож це
 * не «той самий поділ без двох складів», а окрема карта.
 *
 * Живе вона в Google My Maps, і її правлять там же, де й дивляться. Тому
 * читаємо щоразу з неї, а не з копії, яку хтось мусив би оновлювати руками:
 * розбіжність між намальованим і тим, за чим їздять, коштує дорожче за
 * зайвий запит раз на добу.
 */
import { createServiceClient } from '@/lib/supabase/service'
import type { Point } from '@/lib/delivery-zones'

type Service = ReturnType<typeof createServiceClient>

/** Карта «Неділя» у Google My Maps — те саме посилання, тільки як KML */
export const SUNDAY_MAP_ID = '1RHJzq-pE0DnthfspD2feC1I_shxeCWs'
export const SUNDAY_MAP_URL =
  `https://www.google.com/maps/d/kml?mid=${SUNDAY_MAP_ID}&forcekml=1`

/**
 * Назви тек на карті — і наші склади.
 *
 * На карті тека зветься коротко, як кажуть уголос: «АС2», «М10». У нас
 * склад називається повністю, і саме цю назву читає Бітрікс, бланк і чат.
 * Звести їх має щось одне й видиме, а не здогад за схожістю.
 */
const WAREHOUSE_BY_FOLDER: Record<string, string> = {
  ас2: 'АС 2 онлайн',
  гуртівня: 'Гуртівня онлайн',
  санта: 'Санта онлайн',
  м10: 'М 10 онлайн',
  цум: 'МЕ ЦУМ онлайн',
  панськагора: 'МЕ Панська Гора Онлайн',
  /* Зону Іскри возить Санта: власного складу відвантаження в неї немає */
  іскра: 'Санта онлайн',
  сихів: 'Сихів онлайн',
}

const folderKey = (name: string) =>
  name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

export interface SundayZone {
  code: string
  warehouse: string
  polygon: Point[]
}

/**
 * Полігони з KML.
 *
 * Google віддає координати як «довгота,широта,висота» через пробіл — порядок
 * саме такий, і переплутати його означає шукати Львів у Індійському океані.
 *
 * Розбираємо без XML-бібліотеки: у файлі нас цікавлять лише теки, назви й
 * координати, а тягнути заради трьох тегів залежність — зайве.
 */
export function parseSundayKml(kml: string): SundayZone[] {
  const zones: SundayZone[] = []

  const folders = kml.split(/<Folder>/).slice(1)
  for (const folder of folders) {
    const name = folder.match(/<name>([\s\S]*?)<\/name>/)?.[1]?.trim() ?? ''
    const warehouse = WAREHOUSE_BY_FOLDER[folderKey(name)]
    if (!warehouse) continue

    for (const block of folder.matchAll(/<coordinates>([\s\S]*?)<\/coordinates>/g)) {
      const polygon = (block[1] ?? '')
        .trim()
        .split(/\s+/)
        .map(triple => {
          const [lng, lat] = triple.split(',').map(Number)
          return { lat, lng }
        })
        .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))

      // Менше трьох точок — це не фігура, а слід від випадкового кліку
      if (polygon.length >= 3) {
        zones.push({ code: `sunday_${folderKey(name)}`, warehouse, polygon })
      }
    }
  }

  return zones
}

/** Тягне недільну карту й оновлює нашу копію. */
export async function refreshSundayZones(
  service: Service,
): Promise<{ updated: number; warehouses: string[]; error?: string }> {
  try {
    const res = await fetch(SUNDAY_MAP_URL, { signal: AbortSignal.timeout(20_000) })
    if (!res.ok) return { updated: 0, warehouses: [], error: `Google відповів ${res.status}` }

    const zones = parseSundayKml(await res.text())
    if (!zones.length) {
      return { updated: 0, warehouses: [], error: 'на карті не знайшлося жодної зони' }
    }

    const now = new Date().toISOString()
    await service.from('delivery_zones').upsert(
      zones.map(z => ({
        day_kind: 'sunday',
        code: z.code,
        warehouse: z.warehouse,
        polygon: z.polygon,
        color: null,
        updated_at: now,
      })),
      { onConflict: 'day_kind,code' },
    )

    /*
     * Зону, якої на карті вже немає, прибираємо.
     *
     * Склад могли закрити й стерти його фігуру — і якби стара копія
     * лишилась, у неділю туди далі їздили б за нашою пам'яттю, а не за
     * тим, що намальовано.
     */
    await service.from('delivery_zones')
      .delete()
      .eq('day_kind', 'sunday')
      .lt('updated_at', now)

    return { updated: zones.length, warehouses: [...new Set(zones.map(z => z.warehouse))] }
  } catch (e) {
    return { updated: 0, warehouses: [], error: e instanceof Error ? e.message : String(e) }
  }
}

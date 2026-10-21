/**
 * Акції з сайту.
 *
 * На сайті акція — окрема сторінка з банером і описом: «Тільки онлайн»,
 * «Акція тижня». Ні переліку товарів, ні цін на ній немає, тож вигадувати
 * зв'язок «ця акція — ці товари» ми не будемо: покажемо саму акцію так,
 * як вона виглядає на сайті, а знижені ціни візьмемо з нашого каталогу,
 * де вони справді є.
 *
 * Список акцій читаємо з головної сторінки — там вони й живуть. Окремого
 * API для них сайт не дає, тож це розбір сторінки: крихко, але чесно, і
 * нова акція з'явиться в боті сама, щойно її опублікують.
 */
import { createServiceClient } from '@/lib/supabase/service'

type Service = ReturnType<typeof createServiceClient>

export interface SitePromo {
  slug: string
  url: string
  title: string
  description: string | null
  image: string | null
}

const CACHE_KEY = 'site_promos'
/** Акції міняють раз на тиждень, тож пів дня витримки нікого не образить */
const TTL_MS = 12 * 3600_000

const meta = (html: string, property: string): string | null => {
  const m = html.match(
    new RegExp(`<meta[^>]+property=["']og:${property}["'][^>]+content=["']([^"']*)`, 'i'),
  )
  return m ? decode(m[1]) : null
}

const decode = (s: string) => s
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ').trim()

async function fetchPromos(site: string): Promise<SitePromo[]> {
  const home = await fetch(site, { signal: AbortSignal.timeout(20_000) })
  if (!home.ok) return []

  const html = await home.text()
  const slugs = [...new Set(
    [...html.matchAll(/\/promotion\/([a-z0-9-]+)\//g)].map(m => m[1]),
  )]

  const promos: SitePromo[] = []

  for (const slug of slugs.slice(0, 8)) {
    const url = `${site}/promotion/${slug}/`
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
      if (!res.ok) continue
      const page = await res.text()

      const title = (meta(page, 'title') ?? slug)
        // «Тільки онлайн - Галицька Cвіжина» — другу половину клієнт і так знає
        .replace(/\s*[-–|]\s*Галицька.*$/i, '')

      promos.push({
        slug,
        url,
        title,
        description: meta(page, 'description'),
        image: meta(page, 'image'),
      })
    } catch { /* одна недоступна сторінка не має ламати решту */ }
  }

  return promos
}

/** Акції з витримкою: сторінку сайту смикаємо не частіше, ніж двічі на добу */
export async function sitePromos(service: Service, site: string): Promise<SitePromo[]> {
  const { data } = await service
    .from('app_settings').select('value').eq('key', CACHE_KEY).maybeSingle()

  const cached = data?.value as { at?: string; promos?: SitePromo[] } | null
  const fresh = cached?.at && Date.now() - new Date(cached.at).getTime() < TTL_MS

  if (fresh && cached?.promos?.length) return cached.promos

  const promos = await fetchPromos(site)

  // Порожнечу не запам'ятовуємо: сайт міг просто не відповісти, і тоді
  // пів доби бот мовчав би про акції, яких насправді повно
  if (promos.length) {
    await service.from('app_settings').upsert({
      key: CACHE_KEY,
      value: { at: new Date().toISOString(), promos },
    }, { onConflict: 'key' })
    return promos
  }

  return cached?.promos ?? []
}

/**
 * Акції з сайту.
 *
 * На сайті для них є окремий розділ `/promotion/`: кожна акція — сторінка
 * з банером, строком дії та переліком товарів, у яких є ціна. Саме це ми
 * й показуємо, а не вигадуємо акції з наших внутрішніх правил націнки.
 *
 * Окремого API сайт не дає, тож це розбір сторінок. Крихко, але чесно: нова
 * акція з'явиться в боті сама, щойно її опублікують, а якщо верстка
 * зміниться — ми отримаємо порожній список, а не вигадані дані.
 */
import { createServiceClient } from '@/lib/supabase/service'

type Service = ReturnType<typeof createServiceClient>

export interface PromoItem {
  name: string
  url: string
  price: number | null
  unit: string | null
}

export interface SitePromo {
  slug: string
  url: string
  title: string
  dates: string | null
  image: string | null
  items: PromoItem[]
}

const CACHE_KEY = 'site_promos'
/** Акції міняють раз на тиждень, тож пів доби витримки нікого не образить */
const TTL_MS = 12 * 3600_000

/**
 * Текст із HTML у вигляді, придатному для читання.
 *
 * WordPress пише лапки числовими сутностями — `&#8220;Наминака&#8221;`, —
 * і перелічувати їх поіменно означає рано чи пізно пропустити якусь.
 * Тому числові розкодовуємо загальним правилом, а іменовані лишаємо
 * списком: їх небагато і вони не ростуть.
 */
const NAMED: Record<string, string> = {
  amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ',
  laquo: '«', raquo: '»', ndash: '–', mdash: '—', hellip: '…',
}

const decode = (s: string) => s
  .replace(/<[^>]+>/g, ' ')
  .replace(/&#x([\da-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
  .replace(/&([a-z]+);/gi, (whole, name: string) => NAMED[name.toLowerCase()] ?? whole)
  .replace(/\s+/g, ' ').trim()

const get = async (url: string) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  return res.ok ? await res.text() : null
}

/**
 * Банер акції — з переліку, а не зі сторінки.
 *
 * На самій сторінці банер лежить у стилях теми, а в переліку він стоїть
 * звичайною картинкою. Webp оминаємо: Telegram показує його не завжди,
 * а поруч майже завжди є той самий кадр у jpg.
 */
function bannerFor(listing: string, slug: string): string | null {
  const block = listing.match(
    new RegExp(`<a[^>]+href="[^"]*/promotion/${slug}/"[^>]*>([\\s\\S]{0,3000}?)</a>`),
  )
  const scope = block?.[1] ?? ''
  const images = [...scope.matchAll(/(?:src|srcset)="([^" ]+uploads[^" ]+\.(?:jpe?g|png|webp))/g)]
    .map(m => m[1])
    .filter(u => !/logo|zrobleno/i.test(u))

  return images.find(u => !u.endsWith('.webp')) ?? images[0] ?? null
}

/** Товари акції: назва, посилання й ціна — усе зі сторінки самої акції */
function itemsFrom(page: string): PromoItem[] {
  const items: PromoItem[] = []

  for (const block of page.split('class="product-entry').slice(1)) {
    const link = block.match(/href="(https:\/\/[^"]+\/[a-z0-9-]{4,}\/)"/)?.[1]
    const name = block.match(/alt="([^"]*)"/)?.[1]
    const price = block.match(/itemprop="price"[^>]*content="([\d.]+)"/)?.[1]
    const unit = block.match(/(грн\/кг|грн\/шт|грн)/)?.[1]

    if (!link || !name) continue
    items.push({
      name: decode(name),
      url: link,
      price: price ? Number(price) : null,
      unit: unit ?? null,
    })
  }

  return items
}

async function fetchPromos(site: string): Promise<SitePromo[]> {
  const listing = await get(`${site}/promotion/`)
  if (!listing) return []

  const slugs = [...new Set([...listing.matchAll(/\/promotion\/([a-z0-9-]+)\//g)].map(m => m[1]))]
  const promos: SitePromo[] = []

  for (const slug of slugs.slice(0, 8)) {
    const url = `${site}/promotion/${slug}/`
    const page = await get(url)
    if (!page) continue

    // Назва й строк стоять у шапці сторінки, одразу під хлібними крихтами
    const head = page.match(/<div class="banner style-2">([\s\S]{0,800}?)<\/div>\s*<\/div>/)?.[1] ?? ''
    const title = decode(head.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? slug)
    const dates = decode(head.match(/<h5[^>]*>([\s\S]*?)<\/h5>/)?.[1] ?? '') || null

    promos.push({
      slug,
      url,
      title: title || slug,
      dates,
      image: bannerFor(listing, slug),
      items: itemsFrom(page),
    })
  }

  return promos
}

/** Акції з витримкою: сторінки сайту смикаємо не частіше, ніж двічі на добу */
export async function sitePromos(
  service: Service,
  site: string,
  { force = false }: { force?: boolean } = {},
): Promise<SitePromo[]> {
  const { data } = await service
    .from('app_settings').select('value').eq('key', CACHE_KEY).maybeSingle()

  const cached = data?.value as { at?: string; promos?: SitePromo[] } | null
  const fresh = !force && cached?.at
    && Date.now() - new Date(cached.at).getTime() < TTL_MS

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

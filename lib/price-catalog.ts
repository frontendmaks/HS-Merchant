/**
 * Reading a shop that has no search.
 *
 * Plenty of sites — including bespoke ones — have no search endpoint at all,
 * or hide it behind script. What almost all of them do have is a sitemap, and
 * product pages carrying a name and a price in their markup. So instead of
 * asking the site a question, we read its index and go to the pages ourselves.
 *
 * Fetching every product daily would be both slow and rude, so the sitemap is
 * used as a shortlist: our product name is transliterated to compare against
 * the URL slugs, the few most promising pages are opened, and the real
 * Cyrillic name found there is what the actual matching runs on. The lossy
 * step only narrows the field; it never decides.
 */

/**
 * Two schemes, because one shop uses both.
 *
 * Родинна Ковбаска has «філе» as `f-le` on its older pages and `file` on its
 * newer ones — і dropped in one, kept in the other. Matching a single scheme
 * silently misses half a catalogue, which is how «Філе куряче» came back as
 * "not found" while `file-z-kuriatyny` sat in the index.
 */
const SIMPLE: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', ґ: 'g', д: 'd', е: 'e', є: 'e', ж: 'zh',
  з: 'z', и: 'i', і: '', ї: '', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n',
  о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'sch', ь: '', ю: 'yu', я: 'ya', ъ: '', ы: 'i', э: 'e',
  ё: 'e',
}

/** The official Ukrainian romanization, which many engines follow instead. */
const OFFICIAL: Record<string, string> = {
  ...SIMPLE,
  и: 'y', і: 'i', ї: 'i', є: 'ie', ю: 'iu', я: 'ia', х: 'kh', ц: 'ts', щ: 'shch',
}

function apply(raw: string, table: Record<string, string>): string {
  return raw.toLowerCase().split('')
    .map(ch => ch in table ? table[ch] : /[a-z0-9]/.test(ch) ? ch : ' ')
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Cyrillic in, the shape a slug would take out. */
export const translit = (raw: string) => apply(raw, SIMPLE)

/**
 * The word with its vowels removed.
 *
 * Vowels are exactly where transliteration schemes disagree; consonants
 * survive all of them. `kuryatini` and `kuriatyny` are different strings and
 * the same skeleton — so this catches what the two tables between them miss.
 */
const skeleton = (latin: string) => latin.replace(/[aeiouy\s]/g, '')

/** The slug, as comparable words. */
function slugWords(url: string): string {
  const last = url.replace(/\/+$/, '').split('/').pop() ?? ''
  return last.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
}

function dice(a: string, b: string): number {
  const grams = (s: string) => {
    const m = new Map<string, number>()
    for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1)
    return m
  }
  const ga = grams(a), gb = grams(b)
  if (!ga.size || !gb.size) return 0
  let shared = 0
  for (const [g, n] of ga) shared += Math.min(n, gb.get(g) ?? 0)
  return (2 * shared) / (a.length - 1 + b.length - 1)
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0 Safari/537.36'

async function get(url: string, timeoutMs = 20_000): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': UA, 'Accept-Language': 'uk-UA,uk;q=0.9' },
    })
    return res.ok ? await res.text() : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Every product URL the site admits to having.
 *
 * Follows a sitemap index when there is one, and falls back to treating the
 * whole list as candidates when no URL looks like a product path — some shops
 * put products at the root.
 */
export async function fetchCatalog(siteUrl: string): Promise<{ urls: string[]; error?: string }> {
  let origin: string
  try { origin = new URL(siteUrl).origin } catch { return { urls: [], error: 'Некоректна адреса сайту' } }

  const seen: string[] = []
  const queue = [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`]
  const visited = new Set<string>()

  while (queue.length && seen.length < 20_000) {
    const next = queue.shift()!
    if (visited.has(next)) continue
    visited.add(next)

    const xml = await get(next)
    if (!xml) continue

    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => m[1])
    const isIndex = /<sitemapindex/i.test(xml)

    if (isIndex) {
      // Nested sitemaps, but only a few — a shop with dozens is not the case
      // this is for, and following them all would stall the run
      queue.push(...locs.filter(l => l.endsWith('.xml')).slice(0, 12))
    } else {
      seen.push(...locs)
    }
  }

  if (!seen.length) {
    return { urls: [], error: 'На сайті немає sitemap.xml — вкажіть адресу пошуку вручну' }
  }

  const products = seen.filter(u => /\/(product|tovar|products|goods|item)\//i.test(u))
  const pool = products.length ? products : seen

  // The same product repeats under every city prefix. One copy each, the
  // shortest path — which is the one without a prefix.
  const best = new Map<string, string>()
  for (const url of pool) {
    const key = url.replace(/\/+$/, '').split('/').pop() ?? url
    const current = best.get(key)
    if (!current || url.length < current.length) best.set(key, url)
  }

  return { urls: [...best.values()] }
}

/** The pages most likely to be this product, cheapest signal first. */
export function shortlist(productName: string, urls: string[], take = 5): string[] {
  const simple = apply(productName, SIMPLE)
  const official = apply(productName, OFFICIAL)
  const bones = skeleton(simple)

  // Best of the three readings: a slug only has to look like the product under
  // one of them to be worth opening, and opening it settles the question with
  // the real name on the page
  const score = (slug: string) => Math.max(
    dice(simple, slug),
    dice(official, slug),
    dice(bones, skeleton(slug)),
  )

  return urls
    .map(url => ({ url, score: score(slugWords(url)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, take)
    .filter(c => c.score > 0.14)
    .map(c => c.url)
}

const decode = (s: string) => s
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
  .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/\s+/g, ' ').trim()

const toNumber = (raw: string): number | null => {
  const n = Number(raw.replace(/[\s ]/g, '').replace(',', '.').replace(/[^\d.]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Name and price off one product page. */
export async function readProduct(url: string): Promise<{ title: string; price: number } | null> {
  const html = await get(url)
  if (!html) return null

  // Structured data first, then the page's own title as a last resort
  const ld = [...html.matchAll(
    /<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)]
  for (const block of ld) {
    try {
      const data = JSON.parse(block[1].trim()) as Record<string, unknown>
      const offers = Array.isArray(data.offers) ? data.offers[0] : data.offers
      const price = toNumber(String((offers as Record<string, unknown>)?.price ?? ''))
      if (typeof data.name === 'string' && price) return { title: decode(data.name), price }
    } catch { /* the next shape may still parse */ }
  }

  // From the Product scope onward, not from the top of the document. A page's
  // breadcrumbs are marked up with itemprop="name" too and come first, so
  // reading the whole page returns «Головна» — or a section title that three
  // different sausages share.
  const scopeAt = html.search(/itemtype=["'][^"']*schema\.org\/Product["']/i)
  const scope = scopeAt >= 0 ? html.slice(scopeAt) : html

  const priceMatch =
    scope.match(/itemprop=["']price["'][^>]*content=["']([^"']+)["']/i)
    ?? scope.match(/itemprop=["']price["'][^>]*>\s*([\d\s.,]+)</i)
    ?? html.match(/<meta[^>]+property=["']product:price:amount["'][^>]+content=["']([^"']+)["']/i)

  const price = priceMatch ? toNumber(priceMatch[1]) : null
  if (!price) return null

  // The heading first, the meta second. Shops emit «Ковбаса "Бориславська"»
  // into a quoted attribute without escaping the inner quotes, and any reader
  // stops at the first one — leaving every sausage on the site called
  // «Ковбаса». The <h1> carries the same name and cannot be truncated that way.
  // Searched across the page, not from the Product scope: shops put the
  // heading above the marked-up block as often as inside it.
  //
  // The meta fallback reads to `">` rather than to the next quote, because
  // «Ковбаса "Бориславська"» goes into a quoted attribute unescaped — stopping
  // at the first inner quote leaves every sausage on the site called «Ковбаса».
  const nameMatch =
    html.match(/<h1[^>]*>([\s\S]{3,200}?)<\/h1>/i)
    ?? scope.match(/itemprop=["']name["'][^>]*content="([\s\S]{3,200}?)"\s*\/?>/i)
    ?? scope.match(/itemprop=["']name["'][^>]*>\s*([^<]{3,200})</i)
    ?? html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{3,200})["']/i)

  const title = nameMatch ? decode(nameMatch[1].replace(/<[^>]+>/g, ' ')) : ''
  return title ? { title, price } : null
}

/**
 * The same product page, for a given city.
 *
 * A shop serving several cities prices them differently — chicken fillet is
 * 219 ₴ in Lviv and 210 ₴ in Vinnytsia on the same site. Reading whichever page
 * a link happened to point at makes the comparison depend on chance, so every
 * URL is rewritten to the city we are actually competing in.
 */
export function withCity(url: string, cityPath: string): string {
  const city = cityPath.replace(/^\/+|\/+$/g, '')
  if (!city) return url
  try {
    const u = new URL(url)
    const parts = u.pathname.split('/').filter(Boolean)
    // Drop a city prefix already there, then put ours in front
    const marker = parts.findIndex(p => /^(product|products|tovar|goods|item)$/i.test(p))
    const tail = marker > 0 ? parts.slice(marker) : parts
    u.pathname = '/' + [city, ...tail].join('/')
    return u.toString()
  } catch {
    return url
  }
}

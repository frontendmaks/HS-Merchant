import { readProduct, withCity } from '@/lib/price-catalog'
/**
 * Reading prices off a competitor's search results.
 *
 * There is no standard for this, so the reader tries the structured data first
 * and falls back to markup only when there is none. Every site is different and
 * some will yield nothing — that is reported as "не знайдено" rather than
 * papered over, because a silently missing competitor makes our price look
 * better than it is.
 */

export interface Found {
  title: string
  price: number
  url: string | null
}

/** Paths that look like a product page rather than a section or an article. */
const PRODUCT_PATH = /\/(product|products|tovar|tovary|goods|item|catalog\/[^/]+\/[^/]+)\//i

/**
 * Same-site product links on a listing page, in the order they appear.
 *
 * Deliberately conservative: a shop's header links to every category, and
 * treating those as results would compare our sausage against a menu.
 */
export function productLinks(html: string, pageUrl: string): string[] {
  let origin: string
  try { origin = new URL(pageUrl).origin } catch { return [] }

  const out: string[] = []
  const seen = new Set<string>()

  for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    let abs: URL
    try { abs = new URL(m[1], pageUrl) } catch { continue }
    if (abs.origin !== origin) continue
    if (!PRODUCT_PATH.test(abs.pathname)) continue

    const clean = abs.origin + abs.pathname
    if (seen.has(clean)) continue
    seen.add(clean)
    out.push(clean)
  }
  return out
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0 Safari/537.36'

/** `https://shop.ua/search?q={q}` with the name filled in. */
export function buildSearchUrl(template: string, query: string): string {
  const encoded = encodeURIComponent(query)
  return template.includes('{q}')
    ? template.replace(/\{q\}/g, encoded)
    : template + encoded
}

const toNumber = (raw: unknown): number | null => {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw !== 'string') return null
  const cleaned = raw.replace(/\s| /g, '').replace(',', '.').replace(/[^\d.]/g, '')
  const n = Number(cleaned)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Walks whatever shape the site put in its JSON-LD looking for Products. */
function fromJsonLd(html: string): Found[] {
  const out: Found[] = []
  const blocks = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)

  for (const block of blocks) {
    let parsed: unknown
    try { parsed = JSON.parse(block[1].trim()) } catch { continue }

    const visit = (node: unknown, depth = 0) => {
      if (!node || depth > 6) return
      if (Array.isArray(node)) { node.forEach(n => visit(n, depth + 1)); return }
      if (typeof node !== 'object') return

      const o = node as Record<string, unknown>
      const type = o['@type']
      const isProduct = type === 'Product'
        || (Array.isArray(type) && type.includes('Product'))

      if (isProduct && typeof o.name === 'string') {
        const offers = Array.isArray(o.offers) ? o.offers[0] : o.offers
        const price = toNumber((offers as Record<string, unknown>)?.price)
          ?? toNumber(o.price)
        if (price) {
          const url = typeof o.url === 'string' ? o.url
            : typeof (offers as Record<string, unknown>)?.url === 'string'
              ? String((offers as Record<string, unknown>).url) : null
          out.push({ title: o.name, price, url })
        }
      }
      Object.values(o).forEach(v => visit(v, depth + 1))
    }
    visit(parsed)
  }
  return out
}

const decode = (s: string) => s
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .trim()

/**
 * Microdata, the other thing shops mark products up with.
 *
 * Not a general HTML parser and not trying to be — a regex over arbitrary
 * markup is guesswork, which is exactly why the score is shown to a person.
 */
function fromMicrodata(html: string): Found[] {
  const out: Found[] = []
  const scopes = html.split(/itemtype=["'][^"']*\/Product["']/i).slice(1)

  for (const scope of scopes) {
    const chunk = scope.slice(0, 4000)
    const name = chunk.match(/itemprop=["']name["'][^>]*>([^<]{3,200})</i)
      ?? chunk.match(/itemprop=["']name["'][^>]*content=["']([^"']{3,200})["']/i)
    const price = chunk.match(/itemprop=["']price["'][^>]*content=["']([^"']+)["']/i)
      ?? chunk.match(/itemprop=["']price["'][^>]*>([^<]+)</i)
    const href = chunk.match(/href=["']([^"']+)["']/i)

    const value = price ? toNumber(price[1]) : null
    if (name && value) {
      out.push({ title: decode(name[1]), price: value, url: href ? href[1] : null })
    }
  }
  return out
}

/** Absolute, so a stored link still works when opened from our page. */
function absolutize(url: string | null, base: string): string | null {
  if (!url) return null
  try { return new URL(url, base).toString() } catch { return null }
}

export async function searchCompetitor(
  searchTemplate: string,
  query: string,
  timeoutMs = 15_000,
  /** Follow result links in this city, so the prices read are the right ones */
  cityPath = '',
): Promise<{ items: Found[]; error?: string }> {
  const url = buildSearchUrl(searchTemplate, query)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'uk-UA,uk;q=0.9',
      },
    })
    if (!res.ok) return { items: [], error: `HTTP ${res.status}` }

    const html = await res.text()
    const structured = [...fromJsonLd(html), ...fromMicrodata(html)]

    // Most search pages carry no product markup at all — they are a grid of
    // cards with a link each. The links are the reliable part: follow them and
    // read the product pages, which do mark themselves up properly.
    if (!structured.length) {
      const links = productLinks(html, url).map(l => withCity(l, cityPath))
      if (links.length) {
        const read = await Promise.all(links.slice(0, 6).map(readProduct))
        const found: Found[] = read
          .map((p, i) => p ? { title: p.title, price: p.price, url: links[i] } : null)
          .filter((p): p is { title: string; price: number; url: string } => p !== null)
        if (found.length) return { items: found }
      }
    }

    const items = structured
      .map(i => ({ ...i, title: decode(i.title), url: absolutize(i.url, url) }))
      .filter(i => i.title.length > 2)

    if (!items.length) {
      return { items: [], error: 'Не вдалося прочитати товари зі сторінки' }
    }
    // The same product often appears in both readings
    const seen = new Set<string>()
    return {
      items: items.filter(i => {
        const key = `${i.title}|${i.price}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      }).slice(0, 40),
    }
  } catch (e) {
    const msg = e instanceof Error && e.name === 'AbortError'
      ? 'Сайт не відповів вчасно'
      : e instanceof Error ? e.message : String(e)
    return { items: [], error: msg }
  } finally {
    clearTimeout(timer)
  }
}

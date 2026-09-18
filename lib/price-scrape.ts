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
  /** The text printed beside the price — «грн./кг», «грн /100г» — if any */
  unitLabel?: string
}

/** Paths that look like a product page rather than a section or an article. */
const PRODUCT_PATH = /\/(product|products|tovar|tovary|goods|item)\/|\.html?$/i

/** Sections that are never a product, whatever the rest of the path looks like. */
const NOT_PRODUCT = /\/(blog|news|novyny|articles|statti|recipe|retsepty|about|contacts|delivery|payment|cart|login|account|search)\b/i

/**
 * Same-site product links on a listing page, in the order they appear.
 *
 * Deliberately conservative: a shop's header links to every category, and
 * treating those as results would compare our sausage against a menu.
 */
export function productLinks(html: string, pageUrl: string, chrome?: Set<string>): string[] {
  let origin: string
  try { origin = new URL(pageUrl).origin } catch { return [] }

  const out: string[] = []
  const seen = new Set<string>()

  for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    let abs: URL
    try { abs = new URL(m[1], pageUrl) } catch { continue }
    if (abs.origin !== origin) continue
    if (NOT_PRODUCT.test(abs.pathname)) continue

    const deep = abs.pathname.split('/').filter(Boolean).length >= 2
    if (!PRODUCT_PATH.test(abs.pathname) && !deep) continue
    if (chrome?.has(abs.pathname)) continue

    const clean = abs.origin + abs.pathname
    if (seen.has(clean)) continue
    seen.add(clean)
    out.push(clean)
  }
  return out
}

/**
 * The links a site puts on every page.
 *
 * Product URLs are not reliably marked — «М'ясторія» sells
 * /ua/syraya-produktsiya/steyki/steyki-ribay/steyk-ribay-prime.html, which
 * says nothing about being a product. What does distinguish a result from a
 * menu item is that the menu is on the home page too. Fetching it once and
 * subtracting leaves the results.
 */
export async function siteChrome(siteUrl: string): Promise<Set<string>> {
  const out = new Set<string>()
  try {
    const res = await fetch(siteUrl, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'uk-UA,uk;q=0.9' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return out
    const html = await res.text()
    for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
      try { out.add(new URL(m[1], siteUrl).pathname) } catch { /* skip */ }
    }
  } catch { /* no home page read, no subtraction — links just stay as found */ }
  return out
}

/**
 * Products out of a JSON answer, whatever it calls its list.
 *
 * Deliberately shape-agnostic: every shop names the array something different
 * (results, products, items, data), and the prices arrive either in hryvnia or
 * in kopiykas. A four-digit price on a grocery item is the latter.
 */
export function fromJson(raw: string, baseUrl: string): Found[] {
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return [] }

  const out: Found[] = []
  const visit = (node: unknown, depth = 0) => {
    if (!node || depth > 6 || out.length > 60) return
    if (Array.isArray(node)) { node.forEach(n => visit(n, depth + 1)); return }
    if (typeof node !== 'object') return

    const o = node as Record<string, unknown>
    const title = [o.title, o.name, o.productTitle].find(v => typeof v === 'string' && v.length > 2)
    const rawPrice = [o.price, o.currentPrice, o.priceValue].find(
      v => typeof v === 'number' || (typeof v === 'string' && /\d/.test(v)))

    if (typeof title === 'string' && rawPrice != null) {
      let price = typeof rawPrice === 'number' ? rawPrice : Number(String(rawPrice).replace(',', '.'))
      // Kopiykas: grocery lines are not four-figure sums, and zakaz.ua and
      // friends send integers hundredfold
      if (Number.isInteger(price) && price >= 1000) price = price / 100
      if (Number.isFinite(price) && price > 0) {
        const href = [o.url, o.link, o.slug].find(v => typeof v === 'string')
        let url: string | null = null
        try { url = href ? new URL(String(href), baseUrl).toString() : null } catch { /* keep null */ }

        // «unit: kg» means the price already is per kilogram, whatever weight
        // the title mentions. Dividing by the title's «4кг» turned 148 ₴/кг
        // into 37 — a shop four times cheaper than it is.
        const unit = typeof o.unit === 'string' ? o.unit : undefined
        out.push({ title, price, url, unitLabel: unit ? `/${unit}` : undefined })
      }
    }
    Object.values(o).forEach(v => visit(v, depth + 1))
  }
  visit(parsed)

  const seen = new Set<string>()
  return out.filter(i => {
    const key = `${i.title}|${i.price}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * `1 295 ₴`, `371 грн`, `210.00 грн./кг` — a price as a page prints one.
 *
 * Tags are allowed between the number and the currency, because shops style
 * the sign separately: `<div class="price__main">1 640 <span>₴</span>`. A
 * pattern that insists on them being adjacent matches almost no real markup.
 */
const PRICE_NEAR = /([\d][\d\s\u00a0.,]{0,10}\d|\d)\s*(?:<[^>]{0,80}>\s*){0,3}(?:₴|грн)/i

/**
 * A number inside something the page itself calls a price.
 *
 * Needed because the currency sign is often not in the markup at all — this
 * shop writes `<div class="price__main">1640</div>` and draws the ₴ with CSS.
 * Insisting on a currency sign finds nothing on such a page.
 */
const PRICE_CLASS = /class=["'][^"']*price[^"']*["'][^>]*>\s*([\d][\d\s\u00a0.,]{0,10}\d|\d)\s*</i

/**
 * Names and prices straight off the result cards.
 *
 * Each product link anchors a window of markup around it, and a card puts the
 * name and the price within a few hundred characters of the link. This avoids
 * opening every product page — and works where the pages themselves keep their
 * price in a script, which is common enough to be the normal case.
 */
export function fromCards(
  html: string,
  links: string[],
  pageUrl: string,
  cityPath: string,
): Found[] {
  const out: Found[] = []

  for (const link of links.slice(0, 12)) {
    let path: string
    try { path = new URL(link).pathname } catch { continue }

    // The card as the page wrote it — the link without our city rewriting
    const bare = path.replace(new RegExp(`^/${cityPath.replace(/^\/|\/$/g, '')}/`), '/')
    const at = html.indexOf(`href="${bare}"`) >= 0
      ? html.indexOf(`href="${bare}"`)
      : html.indexOf(bare)
    if (at < 0) continue

    const window = html.slice(Math.max(0, at - 400), at + 1800)
    const priceMatch = window.match(PRICE_NEAR) ?? window.match(PRICE_CLASS)
    if (!priceMatch) continue

    const price = Number(priceMatch[1].replace(/[\s\u00a0]/g, '').replace(',', '.'))
    if (!Number.isFinite(price) || price <= 0) continue

    // What the card says the price is per — «грн./кг», «грн /100г». Without it
    // a tray price and a kilogram price look like the same kind of number.
    const after = window.slice(
      (priceMatch.index ?? 0) + priceMatch[0].length,
      (priceMatch.index ?? 0) + priceMatch[0].length + 120)
    let unitLabel = (priceMatch[0] + ' ' + after.replace(/<[^>]*>/g, ' '))
      .replace(/\s+/g, ' ').slice(0, 60)

    // Shops that print no unit beside the price often put the pack weight in
    // its own element — «<div class="price__val">0.2</div>» is 200 г, and
    // without it 60 ₴ looks like a kilogram price instead of 300 ₴/кг
    const kilos = window.match(
      /class=["'][^"']*(?:val|weight|vaha|vaga)[^"']*["'][^>]*>\s*(\d+(?:[.,]\d+)?)\s*</i)
    if (!/кг|\/\s*\d|грн\s*\.?\s*\//i.test(unitLabel) && kilos) {
      const kg = Number(kilos[1].replace(',', '.'))
      if (kg > 0.02 && kg <= 30) unitLabel = `/${Math.round(kg * 1000)}г`
    }

    // The link's own text, then the image alt, then the title attribute —
    // whichever the card used to name the thing.
    //
    // Every candidate is required to contain a letter: the markup between the
    // link and its label is full of whitespace-only text nodes, and the first
    // one of those matches any "text between tags" pattern and wins.
    const anchor = window.slice(window.indexOf(bare))
    const named = (re: RegExp) => {
      for (const m of anchor.matchAll(re)) {
        const text = decode(m[1])
        if (text.length > 3 && /\p{L}{3}/u.test(text)) return text
      }
      return ''
    }

    const title =
      named(/>([^<>]{4,140})</g)
      || named(/alt=["']([^"']{4,140})["']/g)
      || named(/title=["']([^"']{4,140})["']/g)

    if (title.length > 3) out.push({ title, price, url: link, unitLabel })
  }

  const seen = new Set<string>()
  return out.filter(i => {
    if (seen.has(i.title)) return false
    seen.add(i.title)
    return true
  })
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
  /** Paths that appear on the home page, i.e. navigation rather than results */
  chrome?: Set<string>,
): Promise<{ items: Found[]; error?: string }> {
  const url = buildSearchUrl(searchTemplate, query)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json,text/html,application/xhtml+xml',
        'Accept-Language': 'uk-UA,uk;q=0.9',
      },
    })
    if (!res.ok) return { items: [], error: `HTTP ${res.status}` }

    // Some shops answer their own search with JSON rather than a page — often
    // the only readable thing a script-rendered site has
    const contentType = res.headers.get('content-type') ?? ''
    const body = await res.text()
    if (contentType.includes('json') || body.trimStart().startsWith('{')) {
      const items = fromJson(body, url)
      return items.length ? { items } : { items: [], error: 'JSON без товарів' }
    }

    const html = body
    const structured = [...fromJsonLd(html), ...fromMicrodata(html)]

    // Most search pages carry no product markup at all — they are a grid of
    // cards. Read the cards first: the price is right there beside the name,
    // and it is the price the shopper is being shown.
    if (!structured.length) {
      const links = productLinks(html, url, chrome).map(l => withCity(l, cityPath))

      if (links.length) {
        const cards = fromCards(html, links, url, cityPath)
        if (cards.length) return { items: cards }

        // No price on the card: open the pages instead. Slower, and only worth
        // doing for the few that might be the product we are asking about.
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

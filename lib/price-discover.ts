/**
 * Finding a shop's search without being told where it is.
 *
 * Asking someone to paste a URL with a placeholder in it is asking them to
 * understand a query string. Almost every Ukrainian shop runs on one of a
 * handful of platforms, and each puts its search in a known place — so the
 * shorter question is "what is the site", and this tries the known shapes
 * against it with a word it should be able to find.
 */
import { searchCompetitor } from '@/lib/price-scrape'

/**
 * Ordered by how common the shape is here, cheapest guess first.
 *
 * Both shapes matter. Query strings are the obvious ones, but plenty of
 * Ukrainian shops put the term straight in the path — `/search/філе` — and a
 * probe that only ever appends `?q=` decides those sites have no search at all.
 */
const PATTERNS = [
  { name: 'Пошук у шляху',           path: '/search/{q}' },
  { name: 'Пошук у шляху',           path: '/search/{q}/' },
  { name: 'WooCommerce / WordPress', path: '/?s={q}&post_type=product' },
  { name: 'WordPress',               path: '/?s={q}' },
  { name: 'Стандартний пошук',       path: '/search?q={q}' },
  { name: 'Стандартний пошук',       path: '/search/?q={q}' },
  { name: 'Horoshop / Shop-Express', path: '/search/?search={q}' },
  { name: 'OpenCart',                path: '/index.php?route=product/search&search={q}' },
  { name: 'Magento',                 path: '/catalogsearch/result/?q={q}' },
  { name: 'Shopify',                 path: '/search?q={q}&type=product' },
  { name: 'Пошук у шляху',           path: '/poshuk/{q}' },
  { name: 'Пошук у шляху',           path: '/catalog/search/{q}' },
  { name: 'Загальний',               path: '/?search={q}' },
  { name: 'Загальний',               path: '/search?query={q}' },
]

/** A word no shop stocks, used to prove a page is actually filtering. */
const NONSENSE = 'zqxwvkj'

export interface Discovery {
  searchUrl: string | null
  platform: string | null
  tried: number
  error?: string
}

/**
 * @param probe a single common word the shop is likely to stock — «філе»,
 *   «ковбаса». A whole product name is the wrong probe: a competitor that does
 *   not carry that exact item returns nothing, and a working search gets
 *   written off as missing.
 */
export async function discoverSearchUrl(siteUrl: string, probe: string): Promise<Discovery> {
  let base: URL
  try {
    base = new URL(siteUrl)
  } catch {
    return { searchUrl: null, platform: null, tried: 0, error: 'Некоректна адреса сайту' }
  }
  const origin = base.origin

  let tried = 0
  for (const pattern of PATTERNS) {
    const template = origin + pattern.path
    tried++

    const { items, error } = await searchCompetitor(template, probe, 12_000)
    if (error || !items.length) continue

    // Asked for something nobody sells. A page that answers the same way to
    // both is not searching — it is a catalogue that ignores the query, and
    // taking it would match every product against everything.
    const control = await searchCompetitor(template, NONSENSE, 12_000)
    if (control.items.length >= items.length) continue

    return { searchUrl: template, platform: pattern.name, tried }
  }

  return {
    searchUrl: null, platform: null, tried,
    error: 'Не вдалося знайти пошук на сайті — вкажіть адресу вручну',
  }
}

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

/** Ordered by how common the platform is here, cheapest guess first. */
const PATTERNS = [
  { name: 'WooCommerce / WordPress', path: '/?s={q}&post_type=product' },
  { name: 'WordPress',               path: '/?s={q}' },
  { name: 'Стандартний пошук',       path: '/search?q={q}' },
  { name: 'Стандартний пошук',       path: '/search/?q={q}' },
  { name: 'Horoshop / Shop-Express', path: '/search/?search={q}' },
  { name: 'OpenCart',                path: '/index.php?route=product/search&search={q}' },
  { name: 'Magento',                 path: '/catalogsearch/result/?q={q}' },
  { name: 'Shopify',                 path: '/search?q={q}&type=product' },
  { name: 'Загальний',               path: '/?search={q}' },
  { name: 'Загальний',               path: '/search?query={q}' },
]

export interface Discovery {
  searchUrl: string | null
  platform: string | null
  tried: number
  error?: string
}

/**
 * @param probe a word the shop is likely to have — one of our own product
 *   names, so a hit means the search works on the things we will ask about
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

    // A search page that answers with the whole catalogue has not searched —
    // it has ignored the query, and every product would "match" everything
    if (items.length >= 38) continue

    return { searchUrl: template, platform: pattern.name, tried }
  }

  return {
    searchUrl: null, platform: null, tried,
    error: 'Не вдалося знайти пошук на сайті — вкажіть адресу вручну',
  }
}

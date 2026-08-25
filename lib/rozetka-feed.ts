import { calcMarketplacePrice, minWeightLabel, escapeXml, stripControlChars } from '@/lib/feed-xml'

// --- Rozetka ---------------------------------------------------------------
//
// Rozetka pulls this file and both creates and updates cards from it, so its
// rules are strict where MauDau's are lenient:
//   · offer id must be unique, Latin/digits only, and must NEVER change —
//     changing one drops the card to "немає в наявності"
//   · <categories> must actually be declared; categoryId has to point into it
//   · pictures over https, 1 to 15 of them
//   · name up to 255 chars, description up to 50 000
// https://sellerhelp.rozetka.com.ua/p185-pricelist-requirements.html

export interface RzCategoryMeta {
  id: number
  title: string
  attributes: { id: number; title: string; type: string; values: { id: number; value: string }[] }[] | null
}

/** The categories a feed maps onto, keyed by our category name, plus whatever
 *  the editor stored per product. */
export interface RozetkaFeedContext {
  /** our category name -> Rozetka category id, from feed.settings */
  categoryIds: Record<string, string>
  /** Rozetka category id -> its metadata, from rozetka_categories */
  categories: Map<string, RzCategoryMeta>
}

/** Rozetka wants "YYYY-MM-DD hh:mm", not an ISO timestamp. */
function ymlDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Rozetka rejects image URLs with Cyrillic, spaces or plus signs. */
function usableImage(url: string): boolean {
  return /^https:\/\//i.test(url) && !/[\u0400-\u04FF\s+]/.test(url)
}

/** Params the editor stores are prefixed so they cannot collide with a
 *  WooCommerce attribute of the same name. */
const RZ_PARAM = /^_rz_(\d+)$/

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function generateRozetkaYML(feed: any, ctx: RozetkaFeedContext): {
  xml: string; offersCount: number; errorsCount: number; errors: string[]
} {
  const errors: string[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activeFps = feed.feed_products.filter((fp: any) => fp.is_active && fp.product)

  const used = new Map<string, RzCategoryMeta>()
  const offers: string[] = []

  for (const fp of activeFps) {
    const p = fp.product
    const attrs = (p.attributes as Record<string, string>) ?? {}
    const params = (fp.custom_params ?? {}) as Record<string, string>

    // The id has to be permanent. The WooCommerce product id is; our own row id
    // is a uuid and Rozetka allows no hyphens in it.
    const offerId = String(p.external_id ?? '').trim()
    if (!/^[A-Za-z0-9]+$/.test(offerId)) {
      errors.push(`Пропущено — немає стабільного коду товару: ${p.name ?? p.id}`)
      continue
    }

    // Per-product choice wins over the mapping made for its category
    const catId = params['_rz_category'] || ctx.categoryIds[p.category_name ?? ''] || ''
    const cat = catId ? ctx.categories.get(String(catId)) : undefined
    if (!cat) {
      errors.push(`Пропущено — категорію Rozetka не задано: ${p.name ?? offerId}`)
      continue
    }
    used.set(String(cat.id), cat)

    const weightLabel = minWeightLabel(attrs)
    const baseName = fp.custom_name ?? p.name
    const name = (weightLabel ? `${baseName}, ${weightLabel}` : baseName ?? '').slice(0, 255)

    const basePrice = Number(fp.custom_price ?? p.price)
    const price = fp.custom_price
      ? basePrice
      : (calcMarketplacePrice(basePrice, attrs) ?? basePrice)

    if (!name) { errors.push(`Немає назви: ${offerId}`); continue }
    if (!price || price <= 0) { errors.push(`Немає ціни: ${name}`); continue }

    const stock = Math.max(0, Math.floor(Number(fp.custom_stock ?? p.stock ?? 0)))
    const available = p.status === 'active' && stock > 0

    // Rozetka demands at least one picture, so an offer without one would be
    // rejected anyway — better to leave it out and say why.
    const pictures = ((p.images as string[]) ?? []).filter(usableImage).slice(0, 15)
    if (!pictures.length) {
      errors.push(`Пропущено — немає фото за вимогами Rozetka (https, без кирилиці): ${name}`)
      continue
    }

    const oldRaw = p.price_old && Number(p.price_old) > Number(p.price)
      ? (calcMarketplacePrice(Number(p.price_old), attrs) ?? Number(p.price_old))
      : null

    // Characteristics, named and numbered the way Rozetka knows them. Where the
    // attribute takes values from its own list, send the id too — matching on
    // the text alone is how a value silently fails to stick.
    const byId = new Map((cat.attributes ?? []).map(a => [String(a.id), a]))
    const paramXml: string[] = []
    for (const [key, raw] of Object.entries(params)) {
      const m = RZ_PARAM.exec(key)
      if (!m || raw == null || String(raw).trim() === '') continue
      const attr = byId.get(m[1])
      if (!attr) continue
      const value = String(raw).trim()
      const valueId = attr.values?.find(v => v.value === value)?.id
      paramXml.push(
        `      <param name="${escapeXml(attr.title)}" paramid="${attr.id}"` +
        (valueId ? ` valueid="${valueId}"` : '') +
        `>${escapeXml(value)}</param>`,
      )
    }

    offers.push([
      `    <offer id="${offerId}" available="${available}">`,
      `      <name>${escapeXml(name)}</name>`,
      `      <name_ua>${escapeXml(name)}</name_ua>`,
      `      <price>${price}</price>`,
      oldRaw && oldRaw > price ? `      <price_old>${oldRaw}</price_old>` : '',
      `      <currencyId>${p.currency || 'UAH'}</currencyId>`,
      `      <categoryId>${cat.id}</categoryId>`,
      `      <stock_quantity>${stock}</stock_quantity>`,
      ...pictures.map(u => `      <picture>${escapeXml(u)}</picture>`),
      p.vendor ? `      <vendor>${escapeXml(p.vendor)}</vendor>` : '',
      p.sku ? `      <article>${escapeXml(p.sku)}</article>` : '',
      `      <description><![CDATA[${stripControlChars(p.description ?? '').slice(0, 50_000)}]]></description>`,
      ...paramXml,
      `    </offer>`,
    ].filter(Boolean).join('\n'))
  }

  const categoriesXml = [...used.values()]
    .sort((a, b) => a.id - b.id)
    .map(c => `      <category id="${c.id}">${escapeXml(c.title)}</category>`)
    .join('\n')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<yml_catalog date="${ymlDate(new Date())}">
  <shop>
    <name>Галицька Свіжина</name>
    <company>Галицька Свіжина</company>
    <url>https://halytska-svizhyna.ua</url>
    <currencies>
      <currency id="UAH" rate="1"/>
    </currencies>
    <categories>
${categoriesXml}
    </categories>
    <offers>
${offers.join('\n')}
    </offers>
  </shop>
</yml_catalog>`

  return { xml, offersCount: offers.length, errorsCount: errors.length, errors }
}

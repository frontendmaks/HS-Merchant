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

/** Category ids must survive regeneration, so they are derived from the name
 *  rather than from the order products happen to arrive in. FNV-1a, kept well
 *  inside 32 bits; collisions are resolved deterministically by the caller. */
function categoryHash(name: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return (h % 1_000_000_000) + 1
}

function rozetkaCategoryIds(names: string[]): Map<string, number> {
  const out = new Map<string, number>()
  const taken = new Set<number>()
  // Sorted so the resolution of any collision does not depend on product order
  for (const name of [...names].sort()) {
    let id = categoryHash(name)
    while (taken.has(id)) id++
    taken.add(id)
    out.set(name, id)
  }
  return out
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function generateRozetkaYML(feed: any): {
  xml: string; offersCount: number; errorsCount: number; errors: string[]
} {
  const errors: string[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activeFps = feed.feed_products.filter((fp: any) => fp.is_active && fp.product)

  const catIds = rozetkaCategoryIds([...new Set(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    activeFps.map((fp: any) => (fp.product.category_name as string) ?? 'Інше'),
  )] as string[])

  const categoriesXml = [...catIds.entries()]
    .map(([name, id]) => `      <category id="${id}">${escapeXml(name)}</category>`)
    .join('\n')

  const offers: string[] = []

  for (const fp of activeFps) {
    const p = fp.product
    const attrs = (p.attributes as Record<string, string>) ?? {}

    // The id has to be permanent. The WooCommerce product id is, our own row id
    // is a uuid and Rozetka allows no hyphens in it.
    const offerId = String(p.external_id ?? '').trim()
    if (!/^[A-Za-z0-9]+$/.test(offerId)) {
      errors.push(`Пропущено — немає стабільного коду товару: ${p.name ?? p.id}`)
      continue
    }

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

    const merged = { ...attrs, ...(fp.custom_params ?? {}) }
    const params = Object.entries(merged)
      .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
      .map(([k, v]) => `      <param name="${escapeXml(k)}">${escapeXml(String(v))}</param>`)
      .join('\n')

    offers.push([
      `    <offer id="${offerId}" available="${available}">`,
      `      <name>${escapeXml(name)}</name>`,
      `      <name_ua>${escapeXml(name)}</name_ua>`,
      `      <price>${price}</price>`,
      oldRaw && oldRaw > price ? `      <price_old>${oldRaw}</price_old>` : '',
      `      <currencyId>${p.currency || 'UAH'}</currencyId>`,
      `      <categoryId>${catIds.get(p.category_name ?? 'Інше')}</categoryId>`,
      `      <stock_quantity>${stock}</stock_quantity>`,
      ...pictures.map(u => `      <picture>${escapeXml(u)}</picture>`),
      p.vendor ? `      <vendor>${escapeXml(p.vendor)}</vendor>` : '',
      p.sku ? `      <article>${escapeXml(p.sku)}</article>` : '',
      `      <description><![CDATA[${stripControlChars(p.description ?? '').slice(0, 50_000)}]]></description>`,
      params,
      `    </offer>`,
    ].filter(Boolean).join('\n'))
  }

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

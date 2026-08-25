import { createServiceClient } from '@/lib/supabase/service'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
import { sanitizeSku } from '@/lib/transliterate'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  request: NextRequest,
  // The segment is named `id` because the sibling routes under this folder use
  // that name and Next.js requires one name per dynamic path — the value here is
  // the feed's slug, which is what marketplaces fetch the feed by.
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rawSlug } = await params
  const slug = rawSlug.replace(/\.xml$/, '')
  const supabase = createServiceClient()

  const { data: feedRow, error } = await supabase
    .from('feeds')
    .select('*, marketplace:marketplaces(*)')
    .eq('slug', slug)
    .eq('status', 'active')
    .single()

  if (error || !feedRow) {
    console.error('Feed error:', error)
    return new NextResponse('Feed not found', { status: 404 })
  }

  // Paged separately — an embedded join is capped at PostgREST's max-rows (1000),
  // which would silently drop offers from a large feed.
  const feedProducts = await fetchAllRows(() =>
    supabase
      .from('feed_products')
      .select('*, product:products(*)')
      .eq('feed_id', feedRow.id)
  )
  const feed = { ...feedRow, feed_products: feedProducts }

  // Auto-sync removed from feed request — causes timeout when MauDau/Rozetka pulls the feed.
  // Sync WooCommerce manually or via scheduled cron separately.
  const autoSynced = false

  const isMaudau = feed.marketplace?.slug === 'maudau' || feed.marketplace?.name?.toLowerCase().includes('maudau')

  // Build slug→portalId map and portalId→catAttrs map from maudau_categories
  let slugToPortalId: Record<string, string> = {}
  let catAttrsMap: Record<string, Array<{ name: string; values: string[] }>> = {}
  if (isMaudau) {
    const { data: cats } = await supabase
      .from('maudau_categories')
      .select('slug, portal_id, attributes')
      .not('portal_id', 'is', null)
    if (cats) {
      for (const c of cats) {
        slugToPortalId[c.slug] = String(c.portal_id)
        catAttrsMap[String(c.portal_id)] = (c.attributes ?? []).map((a: any) => ({
          name: a.name as string,
          values: (a.values ?? []) as string[],
        }))
      }
    }
  }

  const { xml, offersCount, errorsCount, errors } = isMaudau
    ? generateMaudauYML(feed, slugToPortalId, catAttrsMap)
    : generateYML(feed)

  // Log access (fire-and-forget)
  const now = new Date().toISOString()
  supabase.from('feed_access_logs').insert({
    feed_id: feed.id,
    accessed_at: now,
    offers_count: offersCount,
    errors_count: errorsCount,
    errors: errors,
    auto_synced: autoSynced,
  }).then(() => {})

  supabase.from('feeds').update({
    last_accessed_at: now,
    access_count: (feed.access_count ?? 0) + 1,
  }).eq('id', feed.id).then(() => {})

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

/**
 * Marketplace price for weight products:
 * кг/л: price is per kg → multiply by min_kg (default 0.4 = 400g if no min)
 * г/мл: price is already per-portion → no change
 * piece: return null (no transformation)
 */
function calcMarketplacePrice(price: number, attrs: Record<string, string> | null): number | null {
  const unit = (attrs?.['Одиниця'] ?? '').toLowerCase()
  const minRaw = parseFloat(attrs?.['Мін'] ?? '0') || 0
  if (unit === 'кг' || unit === 'л') {
    const minKg = minRaw > 0 ? minRaw : 0.4
    return Math.round(price * minKg * 100) / 100
  }
  if (unit === 'г' || unit === 'мл') {
    return Math.round(price * 100) / 100
  }
  return null
}

/** Min weight label for product name (weight products only, in grams) */
function minWeightLabel(attrs: Record<string, string> | null): string | null {
  const unit = (attrs?.['Одиниця'] ?? '').toLowerCase()
  const minRaw = parseFloat(attrs?.['Мін'] ?? '0') || 0
  if (unit === 'кг' || unit === 'л') return `${minRaw > 0 ? Math.round(minRaw * 1000) : 400} г`
  if (unit === 'г' || unit === 'мл') return `${minRaw > 0 ? Math.round(minRaw) : 400} ${unit}`
  return null
}

/** Generic YML format */
function generateYML(feed: any): { xml: string; offersCount: number; errorsCount: number; errors: string[] } {
  const errors: string[] = []
  const products = feed.feed_products
    .filter((fp: any) => fp.is_active && fp.product)
    .map((fp: any) => {
      const p = fp.product
      const attrs = (p.attributes as Record<string, string>) ?? {}
      const weightLabel = minWeightLabel(attrs)
      const baseName = fp.custom_name ?? p.name
      const name = weightLabel ? `${baseName}, ${weightLabel}` : baseName
      const basePrice = Number(fp.custom_price ?? p.price)
      const mPrice = fp.custom_price ? basePrice : (calcMarketplacePrice(basePrice, attrs) ?? basePrice)
      const price = mPrice
      if (!price) errors.push(`Немає ціни: ${name || p.sku || p.id}`)
      if (!name) errors.push(`Немає назви: ${p.sku || p.id}`)
      const images = (p.images as string[])
        .map((url: string) => `<picture>${url}</picture>`)
        .join('\n        ')
      const mergedAttrs = { ...attrs, ...(fp.custom_params ?? {}) }
      const attrsXml = Object.entries(mergedAttrs)
        .map(([k, v]) => `<param name="${k}">${v}</param>`)
        .join('\n        ')
      const oldPriceRaw = p.price_old && Number(p.price_old) > Number(p.price)
        ? (calcMarketplacePrice(Number(p.price_old), attrs) ?? Number(p.price_old))
        : null
      const oldPriceLine = oldPriceRaw && oldPriceRaw > price ? `\n      <oldprice>${oldPriceRaw}</oldprice>` : ''

      return `
    <offer id="${p.id}" available="${p.status === 'active'}">
      <name>${escapeXml(name)}</name>
      <price>${price}</price>${oldPriceLine}
      <currencyId>${p.currency}</currencyId>
      <categoryId>${p.category_id ?? 1}</categoryId>
      ${images}
      <description><![CDATA[${p.description ?? ''}]]></description>
      <vendor>${escapeXml(p.vendor ?? '')}</vendor>
      <vendorCode>${escapeXml(p.sku ?? '')}</vendorCode>
      ${attrsXml}
    </offer>`
    })

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE yml_catalog SYSTEM "shops.dtd">
<yml_catalog date="${new Date().toISOString()}">
  <shop>
    <name>${escapeXml(feed.marketplace?.settings?.company ?? 'Галицька Свіжина')}</name>
    <company>Галицька Свіжина</company>
    <url>https://halytska-svizhyna.ua</url>
    <currencies>
      <currency id="UAH" rate="1"/>
    </currencies>
    <offers>
      ${products.join('\n')}
    </offers>
  </shop>
</yml_catalog>`

  return { xml, offersCount: products.length, errorsCount: errors.length, errors }
}

// Brand name normalization: our extracted name → MauDau's registered name
const MAUDAU_BRAND_MAP: Record<string, string> = {
  // Case corrections (brand exists in MauDau but wrong case in our DB)
  'VODA UA': 'Voda UA',
  'Клуб сиру': 'Клуб Сиру',
  'DIJO': 'Dijo',
  'HELCOM': 'Helcom',
  'AKURA': 'Akura',
  // Aliases / Latin↔Cyrillic variants
  'Млековіта': 'Mlekovita',
  'Kazerei': 'Käserei Champignon',
  'Kaserei': 'Käserei Champignon',
  'Kazereil': 'Käserei Champignon',
  'Млекпол': 'Mlekpol',
  'НАМЕ': 'Hame',
  // Brands registered in MauDau under a different name
  'Вербена': 'Verbena',
  'Натахтарі': 'Natakhtari',
  'Козуб': 'Козуб Продукт',
}

function normalizeMaudauBrand(brand: string): string {
  return MAUDAU_BRAND_MAP[brand] ?? brand
}

/** MauDau-specific YML format per MauDau import spec */
function generateMaudauYML(
  feed: any,
  slugToPortalId: Record<string, string> = {},
  catAttrsMap: Record<string, Array<{ name: string; values: string[] }>> = {},
): { xml: string; offersCount: number; errorsCount: number; errors: string[] } {
  const activeFps = feed.feed_products.filter((fp: any) => fp.is_active && fp.product)
  const errors: string[] = []

  // Build ordered list of unique categories from active products
  // Per MauDau spec: id = our stable numeric id (unique per WC category),
  // portal_id = MauDau category id for auto-matching (may repeat across WC categories)
  const categoryPortalIds: Record<string, string> = feed.settings?.category_portal_ids ?? {}
  const catIdMap = new Map<string, string>()       // catName → our numeric id
  const catPortalIdMap = new Map<string, string>() // catName → resolved portal_id
  const categoryRows: { numId: string; portalId: string; name: string }[] = []
  let numCounter = 0

  for (const fp of activeFps) {
    const catName = fp.product.category_name ?? 'Без категорії'
    if (catIdMap.has(catName)) continue
    // Resolve portal_id: if slug stored → look up numeric id; if already numeric → use directly
    const rawPortalId = categoryPortalIds[catName] ?? ''
    const portalId = rawPortalId
      ? (/^\d+$/.test(rawPortalId) ? rawPortalId : (slugToPortalId[rawPortalId] ?? rawPortalId))
      : ''
    const numId = String(++numCounter)
    catIdMap.set(catName, numId)
    catPortalIdMap.set(catName, portalId)
    categoryRows.push({ numId, portalId, name: catName })
  }

  // <category id="1" portal_id="ковбаси"> — id is our numeric, portal_id is MauDau's
  const categoriesXml = categoryRows
    .map(({ numId, portalId, name }) => {
      const portalAttr = portalId ? ` portal_id="${escapeXml(portalId)}"` : ''
      return `    <category id="${numId}"${portalAttr}>${escapeXml(name)}</category>`
    })
    .join('\n')

  const offersXml = activeFps
    .map((fp: any) => {
      const p = fp.product
      const attrs_map = { ...(p.attributes as Record<string, string>) ?? {}, ...(fp.custom_params ?? {}) }
      const weightLabel = minWeightLabel(p.attributes as Record<string, string> | null)
      const baseNameUa = fp.custom_name ?? p.name
      const nameUa = weightLabel ? `${baseNameUa}, ${weightLabel}` : baseNameUa
      const nameRu = fp.name_ru ?? nameUa
      // MauDau requires non-empty description — fall back to product name if empty
      const descUa = (p.description && p.description.trim()) ? p.description.trim() : nameUa
      const descRu = (fp.description_ru && fp.description_ru.trim()) ? fp.description_ru.trim() : (descUa === nameUa ? nameRu : descUa)
      const stock = fp.custom_stock ?? p.stock
      const catId = catIdMap.get(p.category_name ?? 'Без категорії') ?? '1'

      // Calculate marketplace price: custom_params override first, then custom_price, then weight formula
      const basePrice = Number(p.price)
      const customParamPrice = fp.custom_params?.['Ціна на маркетплейсі']
      const unitPrice = customParamPrice && Number(customParamPrice) > 0
        ? Number(customParamPrice)
        : fp.custom_price
          ? Number(fp.custom_price)
          : (calcMarketplacePrice(basePrice, p.attributes as Record<string, string> | null) ?? basePrice)

      // Validate
      const label = nameUa || p.sku || p.id
      if (!unitPrice || unitPrice <= 0) errors.push(`Немає ціни: ${label}`)
      if (!nameUa) errors.push(`Немає назви: ${p.sku || p.id}`)
      if (!p.images?.length) errors.push(`Немає фото: ${label}`)

      const images = ((p.images as string[]) ?? [])
        .slice(0, 12)
        .map((url: string) => `      <picture>${escapeXml(url)}</picture>`)
        .join('\n')

      // temperature_mode: MauDau expects "cooling" or "freezing" (English), not Ukrainian
      const typObrobky = attrs_map['Тип обробки'] ?? ''
      const tempMode = /замор/i.test(typObrobky) ? 'freezing' : 'cooling'

      // country: dedicated XML tag (Ukrainian name)
      const countryName = attrs_map['Країна виробник'] ?? 'Україна'

      // Fields that have dedicated XML tags or are WC-internal — always excluded from <param>
      const ALWAYS_EXCLUDED = new Set([
        'Крок', 'крок', 'Мінімальний крок', 'Мін', 'мін', 'Одиниця', 'одиниця', 'Назва', 'Опис',
        'Тип обробки',    // rendered as <temperature_mode>
        'Країна виробник', // rendered as <country>
        'Торгова марка',   // rendered as <vendor>
        'Вага упаковки',   // legacy WC field, not a MauDau characteristic
        'Гарантія',        // requires bilingual columns in xlsx, skip from feed too
      ])

      // Look up MauDau allowed attributes for this product's category
      const productPortalId = catPortalIdMap.get(p.category_name ?? 'Без категорії') ?? ''
      const allowedCatAttrs = productPortalId ? (catAttrsMap[productPortalId] ?? []) : []
      const allowedAttrMap = new Map(allowedCatAttrs.map(a => [a.name, a.values]))

      const attrs = Object.entries(attrs_map)
        .filter(([k, v]) => {
          if (ALWAYS_EXCLUDED.has(k)) return false
          const s = String(v).trim()
          if (!s) return false

          // If we have category attribute data, validate name and value
          if (allowedAttrMap.size > 0) {
            const allowedValues = allowedAttrMap.get(k)
            if (allowedValues === undefined) return false // attr not in this category
            if (allowedValues.length > 0 && !allowedValues.includes(s)) return false // value not in allowed list
          }

          return true
        })
        .map(([k, v]) => `      <param name="${escapeXml(k)}">${escapeXml(String(v))}</param>`)
        .join('\n')

      const offerId = sanitizeSku(p.sku || String(p.external_id || p.id))

      // MauDau treats fractional quantity as 0 → use integer ceiling
      // Active products with stock=0 treated as unlimited (no quantity tag) since WC may have tracking disabled
      const quantityInt = (stock != null && stock > 0) ? Math.ceil(stock) : null
      const quantityLine = quantityInt != null ? `\n      <quantity>${quantityInt}</quantity>` : ''

      // Sale price: p.price = current (discounted), p.price_old = original price before discount
      // Only include if price_old > price (genuine sale) and no manual marketplace price override
      const oldPriceM = !customParamPrice && p.price_old && Number(p.price_old) > Number(p.price)
        ? (calcMarketplacePrice(Number(p.price_old), p.attributes as Record<string, string> | null) ?? Number(p.price_old))
        : null
      const oldPriceLine = oldPriceM && oldPriceM > unitPrice ? `\n      <price_old>${oldPriceM}</price_old>` : ''

      return `    <offer id="${offerId}" available="true">
      <name_ua>${escapeXml(nameUa.slice(0, 255))}</name_ua>
      <name_ru>${escapeXml(nameRu.slice(0, 255))}</name_ru>
      <description_ua>${descToXml(descUa)}</description_ua>
      <description_ru>${descToXml(descRu)}</description_ru>
      <price>${unitPrice ?? 0}</price>${oldPriceLine}
      <currencyId>UAH</currencyId>
      <categoryId>${catId}</categoryId>${quantityLine}
      <temperature_mode>${tempMode}</temperature_mode>
      <country>${escapeXml(countryName)}</country>
${images}
      <vendor>${escapeXml(normalizeMaudauBrand(p.brand ?? 'Галицька Свіжина'))}</vendor>
      <vendorCode>${escapeXml(p.sku ?? '')}</vendorCode>
${attrs}
    </offer>`
    })
    .join('\n\n')

  const now = new Date()
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<yml_catalog date="${dateStr}">
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
${offersXml}
    </offers>
  </shop>
</yml_catalog>`

  return { xml, offersCount: activeFps.length, errorsCount: errors.length, errors }
}

function escapeXml(str: string): string {
  if (!str) return ''
  return stripControlChars(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// For descriptions: MauDau allows HTML but no CDATA — escape only & keep tags intact
function descToXml(str: string, maxLen = 10000): string {
  if (!str) return ''
  return stripControlChars(str)
    .slice(0, maxLen)
    .replace(/&/g, '&amp;')
}

// Strip XML-forbidden control characters (ASCII 0-8, 11-12, 14-31)
function stripControlChars(str: string): string {
  return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
}

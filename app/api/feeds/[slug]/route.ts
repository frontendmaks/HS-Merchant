import { createServiceClient } from '@/lib/supabase/service'
import { sanitizeSku } from '@/lib/transliterate'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug: rawSlug } = await params
  const slug = rawSlug.replace(/\.xml$/, '')
  const supabase = createServiceClient()

  const { data: feed, error } = await supabase
    .from('feeds')
    .select(`
      *,
      marketplace:marketplaces(*),
      feed_products(
        *,
        product:products(*)
      )
    `)
    .eq('slug', slug)
    .eq('status', 'active')
    .single()

  if (error || !feed) {
    console.error('Feed error:', error)
    return new NextResponse('Feed not found', { status: 404 })
  }

  // Auto-sync removed from feed request — causes timeout when MauDau/Rozetka pulls the feed.
  // Sync WooCommerce manually or via scheduled cron separately.
  const autoSynced = false

  const isMaudau = feed.marketplace?.slug === 'maudau' || feed.marketplace?.name?.toLowerCase().includes('maudau')

  // Build slug→portalId map from maudau_categories for numeric portal_id lookup
  let slugToPortalId: Record<string, string> = {}
  if (isMaudau) {
    const { data: cats } = await supabase
      .from('maudau_categories')
      .select('slug, portal_id')
      .not('portal_id', 'is', null)
    if (cats) slugToPortalId = Object.fromEntries(cats.map((c: any) => [c.slug, c.portal_id]))
  }

  const { xml, offersCount, errorsCount, errors } = isMaudau
    ? generateMaudauYML(feed, slugToPortalId)
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

/** Generic YML format */
function generateYML(feed: any): { xml: string; offersCount: number; errorsCount: number; errors: string[] } {
  const errors: string[] = []
  const products = feed.feed_products
    .filter((fp: any) => fp.is_active && fp.product)
    .map((fp: any) => {
      const p = fp.product
      const price = fp.custom_price ?? p.price
      const name = fp.custom_name ?? p.name
      if (!price) errors.push(`Немає ціни: ${name || p.sku || p.id}`)
      if (!name) errors.push(`Немає назви: ${p.sku || p.id}`)
      const images = (p.images as string[])
        .map((url: string) => `<picture>${url}</picture>`)
        .join('\n        ')
      const mergedAttrs = { ...(p.attributes as Record<string, string>), ...(fp.custom_params ?? {}) }
      const attrs = Object.entries(mergedAttrs)
        .map(([k, v]) => `<param name="${k}">${v}</param>`)
        .join('\n        ')
      const oldPriceLine = p.price_old ? `\n      <oldprice>${p.price_old}</oldprice>` : ''

      return `
    <offer id="${p.id}" available="${p.status === 'active' && p.stock > 0}">
      <name>${escapeXml(name)}</name>
      <price>${price}</price>${oldPriceLine}
      <currencyId>${p.currency}</currencyId>
      <categoryId>${p.category_id ?? 1}</categoryId>
      ${images}
      <description><![CDATA[${p.description ?? ''}]]></description>
      <vendor>${escapeXml(p.vendor ?? '')}</vendor>
      <vendorCode>${escapeXml(p.sku ?? '')}</vendorCode>
      ${attrs}
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
  'Grissin Bon': 'GrissinBon',
  'Pikolo': 'Піколо',
  'Млекпол': 'Mlekpol',   // MauDau registered as Latin
  'НАМЕ': 'Hame',          // MauDau registered as Hame
}

function normalizeMaudauBrand(brand: string): string {
  return MAUDAU_BRAND_MAP[brand] ?? brand
}

/** MauDau-specific YML format per MauDau import spec */
function generateMaudauYML(feed: any, slugToPortalId: Record<string, string> = {}): { xml: string; offersCount: number; errorsCount: number; errors: string[] } {
  const activeFps = feed.feed_products.filter((fp: any) => fp.is_active && fp.product)
  const errors: string[] = []

  // Build ordered list of unique categories from active products
  // Per MauDau spec: id = our stable numeric id, portal_id = MauDau category id for auto-matching
  const categoryPortalIds: Record<string, string> = feed.settings?.category_portal_ids ?? {}
  const catIdMap = new Map<string, string>()       // catName → our numeric id
  const seenPortalIds = new Set<string>()           // deduplicate by portal_id
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
    if (portalId && seenPortalIds.has(portalId)) {
      // Reuse existing numeric id for this portal_id
      const existing = categoryRows.find(r => r.portalId === portalId)!
      catIdMap.set(catName, existing.numId)
      continue
    }
    const numId = String(++numCounter)
    catIdMap.set(catName, numId)
    if (portalId) seenPortalIds.add(portalId)
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
      const nameUa = fp.custom_name ?? p.name
      const nameRu = fp.name_ru ?? nameUa
      // MauDau requires non-empty description — fall back to product name if empty
      const descUa = (p.description && p.description.trim()) ? p.description.trim() : nameUa
      const descRu = (fp.description_ru && fp.description_ru.trim()) ? fp.description_ru.trim() : (descUa === nameUa ? nameRu : descUa)
      const stock = fp.custom_stock ?? p.stock
      const catId = catIdMap.get(p.category_name ?? 'Без категорії') ?? '1'

      // Merge product attributes with feed-level custom params (custom_params override)
      const attrs_map = { ...(p.attributes as Record<string, string>) ?? {}, ...(fp.custom_params ?? {}) }
      const stepAttr = attrs_map['Крок'] ?? attrs_map['крок'] ?? attrs_map['Мінімальний крок'] ?? null
      const weightStep = stepAttr ? parseFloat(stepAttr.replace(',', '.')) : null

      // Calculate unit price for weighted products (price stored as per-kg)
      let unitPrice = fp.custom_price ?? p.price
      if (!fp.custom_price && weightStep && weightStep > 0 && weightStep < 1) {
        unitPrice = Math.round(p.price * weightStep)
      }

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

      // Excluded from <param>: internal fields + fields that have dedicated XML tags
      const EXCLUDED_PARAMS = new Set([
        'Крок', 'крок', 'Мінімальний крок', 'Вага', 'вага',
        'Мін', 'мін', 'Одиниця', 'одиниця', 'Назва', 'Опис',
        'Тип обробки', 'Країна виробник',
      ])
      // Ensure Торгова марка is always present as a param (from custom_params or brand field)
      const brandForParam = attrs_map['Торгова марка'] ?? normalizeMaudauBrand(p.brand ?? 'Галицька Свіжина')
      const attrsWithDefaults: Record<string, string> = {
        'Торгова марка': brandForParam,
        ...attrs_map,
      }

      const attrs = Object.entries(attrsWithDefaults)
        .filter(([k, v]) => !EXCLUDED_PARAMS.has(k) && String(v).trim())
        .map(([k, v]) => `      <param name="${escapeXml(k)}">${escapeXml(String(v))}</param>`)
        .join('\n')

      const offerId = sanitizeSku(p.sku || String(p.external_id || p.id))

      // MauDau treats fractional quantity as 0 → use integer ceiling
      const quantityInt = stock != null ? (stock > 0 ? Math.ceil(stock) : 0) : null
      const quantityLine = quantityInt != null ? `\n      <quantity>${quantityInt}</quantity>` : ''

      // Sale price: p.price = current (discounted), p.price_old = original price before discount
      const oldPriceLine = p.price_old ? `\n      <price_old>${p.price_old}</price_old>` : ''

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

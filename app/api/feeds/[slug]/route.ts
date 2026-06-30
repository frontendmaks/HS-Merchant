import { createServiceClient } from '@/lib/supabase/service'
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
  const { xml, offersCount, errorsCount, errors } = isMaudau
    ? generateMaudauYML(feed)
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
function generateMaudauYML(feed: any): { xml: string; offersCount: number; errorsCount: number; errors: string[] } {
  const activeFps = feed.feed_products.filter((fp: any) => fp.is_active && fp.product)
  const errors: string[] = []

  // Build ordered list of unique categories from active products
  const categoryPortalIds: Record<string, string> = feed.settings?.category_portal_ids ?? {}
  // catIdMap: our catName → portal_id to use in <categoryId>
  const catIdMap = new Map<string, string>()
  // seenPortalIds: deduplicate <category> blocks by portal_id
  const seenPortalIds = new Map<string, string>() // portalId → first catName
  let fallbackCounter = 0

  for (const fp of activeFps) {
    const catName = fp.product.category_name ?? 'Без категорії'
    if (catIdMap.has(catName)) continue
    const portalId = categoryPortalIds[catName] ?? String(++fallbackCounter)
    catIdMap.set(catName, portalId)
    if (!seenPortalIds.has(portalId)) seenPortalIds.set(portalId, catName)
  }

  // One <category> per unique portal_id
  const categoriesXml = [...seenPortalIds.entries()]
    .map(([portalId, name]) => `    <category id="${escapeXml(portalId)}">${escapeXml(name)}</category>`)
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

      // Exclude 'Вага' from params — MauDau has predefined weight values, arbitrary gram values cause warnings
      // Also exclude step/крок (internal field)
      const EXCLUDED_PARAMS = new Set(['Крок', 'крок', 'Мінімальний крок', 'Вага', 'вага', 'Мін', 'мін', 'Одиниця', 'одиниця', 'Назва', 'Опис'])
      const attrs = Object.entries(attrs_map)
        .filter(([k]) => !EXCLUDED_PARAMS.has(k))
        .map(([k, v]) => `      <param name="${escapeXml(k)}">${escapeXml(String(v))}</param>`)
        .join('\n')

      const offerId = (p.sku || String(p.external_id || p.id))
        .replace(/[^a-zA-Z0-9\-_]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || String(p.id).replace(/[^a-zA-Z0-9]/g, '')

      // MauDau treats fractional quantity as 0 → use integer ceiling
      const quantityInt = stock != null ? (stock > 0 ? Math.ceil(stock) : 0) : null
      const quantityLine = quantityInt != null ? `\n      <quantity>${quantityInt}</quantity>` : ''

      // Sale price: p.price = current (discounted), p.price_old = original price before discount
      const oldPriceLine = p.price_old ? `\n      <price_old>${p.price_old}</price_old>` : ''

      return `    <offer id="${offerId}" available="true">
      <name_ua>${escapeXml(nameUa)}</name_ua>
      <name_ru>${escapeXml(nameRu)}</name_ru>
      <description_ua><![CDATA[${descUa}]]></description_ua>
      <description_ru><![CDATA[${descRu}]]></description_ru>
      <price>${unitPrice ?? 0}</price>${oldPriceLine}
      <currencyId>UAH</currencyId>
      <categoryId>${catId}</categoryId>${quantityLine}
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
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

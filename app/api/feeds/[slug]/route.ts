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

  const isMaudau = feed.marketplace?.slug === 'maudau' || feed.marketplace?.name?.toLowerCase().includes('maudau')
  const xml = isMaudau ? generateMaudauYML(feed) : generateYML(feed)

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}

/** Generic YML format */
function generateYML(feed: any): string {
  const products = feed.feed_products
    .filter((fp: any) => fp.is_active && fp.product)
    .map((fp: any) => {
      const p = fp.product
      const price = fp.custom_price ?? p.price
      const name = fp.custom_name ?? p.name
      const images = (p.images as string[])
        .map((url: string) => `<picture>${url}</picture>`)
        .join('\n        ')
      const attrs = Object.entries(p.attributes as Record<string, string>)
        .map(([k, v]) => `<param name="${k}">${v}</param>`)
        .join('\n        ')

      return `
    <offer id="${p.id}" available="${p.status === 'active' && p.stock > 0}">
      <name>${escapeXml(name)}</name>
      <price>${price}</price>
      <currencyId>${p.currency}</currencyId>
      <categoryId>${p.category_id ?? 1}</categoryId>
      ${images}
      <description><![CDATA[${p.description ?? ''}]]></description>
      <vendor>${escapeXml(p.vendor ?? '')}</vendor>
      <vendorCode>${escapeXml(p.sku ?? '')}</vendorCode>
      ${attrs}
    </offer>`
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
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
      ${products}
    </offers>
  </shop>
</yml_catalog>`
}

/** MauDau-specific YML format per MauDau import spec */
function generateMaudauYML(feed: any): string {
  const activeFps = feed.feed_products.filter((fp: any) => fp.is_active && fp.product)

  // Build ordered list of unique categories from active products
  const categoryPortalIds: Record<string, string> = feed.settings?.category_portal_ids ?? {}
  const seenCats = new Set<string>()
  const categoryList: { id: number; name: string; portalId: string | null }[] = []
  const catIndexMap = new Map<string, number>() // category_name → 1-based index

  for (const fp of activeFps) {
    const catName = fp.product.category_name ?? 'Без категорії'
    if (!seenCats.has(catName)) {
      seenCats.add(catName)
      const idx = categoryList.length + 1
      categoryList.push({ id: idx, name: catName, portalId: categoryPortalIds[catName] ?? null })
      catIndexMap.set(catName, idx)
    }
  }

  const categoriesXml = categoryList
    .map(c => {
      const portalAttr = c.portalId ? ` portal_id="${c.portalId}"` : ''
      return `    <category id="${c.id}"${portalAttr}>${escapeXml(c.name)}</category>`
    })
    .join('\n')

  const offersXml = activeFps
    .map((fp: any) => {
      const p = fp.product
      const price = fp.custom_price ?? p.price
      const nameUa = fp.custom_name ?? p.name
      const nameRu = fp.name_ru ?? nameUa
      const descUa = p.description ?? ''
      const descRu = fp.description_ru ?? descUa
      const available = (p.stock == null || p.stock > 0) ? 'true' : 'false'
      const catId = catIndexMap.get(p.category_name ?? 'Без категорії') ?? 1

      const images = ((p.images as string[]) ?? [])
        .slice(0, 12)
        .map((url: string) => `      <picture>${escapeXml(url)}</picture>`)
        .join('\n')

      const attrs = Object.entries((p.attributes as Record<string, string>) ?? {})
        .map(([k, v]) => `      <param name="${escapeXml(k)}">${escapeXml(v)}</param>`)
        .join('\n')

      // Sanitize SKU for offer id — alphanumeric + hyphens only
      const offerId = (p.sku || String(p.external_id || p.id))
        .replace(/[^a-zA-Z0-9\-_]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || String(p.id).replace(/[^a-zA-Z0-9]/g, '')

      return `    <offer id="${offerId}" available="${available}">
      <name_ua>${escapeXml(nameUa)}</name_ua>
      <name_ru>${escapeXml(nameRu)}</name_ru>
      <description_ua><![CDATA[${descUa}]]></description_ua>
      <description_ru><![CDATA[${descRu}]]></description_ru>
      <price>${price ?? 0}</price>
      <currencyId>UAH</currencyId>
      <categoryId>${catId}</categoryId>
${images}
      <vendor>${escapeXml(p.brand ?? 'Галицька Свіжина')}</vendor>
      <vendorCode>${escapeXml(p.sku ?? '')}</vendorCode>
${attrs}
    </offer>`
    })
    .join('\n\n')

  const now = new Date()
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

  return `<?xml version="1.0" encoding="UTF-8"?>
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

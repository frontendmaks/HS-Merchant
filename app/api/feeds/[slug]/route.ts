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

  const xml = generateYML(feed)

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}

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

function escapeXml(str: string): string {
  if (!str) return ''
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

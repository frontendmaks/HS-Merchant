/**
 * GET /api/maudau/categories
 *
 * Fetches unique categories from the merchant's existing MauDau products.
 * MauDau has no dedicated "list categories" endpoint, so we pull them from
 * the product catalogue and deduplicate.
 *
 * Returns: { categories: { slug: string; title: string }[] }
 */

import { getMaudauJwt, invalidateMaudauJwt } from '@/lib/maudau'
import { NextResponse } from 'next/server'

async function fetchMaudauProducts(jwt: string): Promise<any[]> {
  const base = process.env.MAUDAU_BASE!
  const all: any[] = []
  let page = 1
  const perPage = 100

  while (true) {
    const res = await fetch(
      `${base}/v1/merchant_public_api/products?per_page=${perPage}&page=${page}`,
      { headers: { Authorization: `Bearer ${jwt}` }, cache: 'no-store' }
    )
    if (!res.ok) throw new Error(`MauDau products failed: ${res.status}`)
    const data: any = await res.json()
    const items: any[] = data?.data ?? data ?? []
    all.push(...items)
    if (items.length < perPage) break
    page++
    if (page > 20) break // safety cap
  }
  return all
}

export async function GET() {
  try {
    let jwt = await getMaudauJwt()
    let products: any[]

    try {
      products = await fetchMaudauProducts(jwt)
    } catch (e: any) {
      if (e.message?.includes('401') || e.message?.includes('403')) {
        invalidateMaudauJwt()
        jwt = await getMaudauJwt()
        products = await fetchMaudauProducts(jwt)
      } else {
        throw e
      }
    }

    // Extract unique categories from main_category field
    const seen = new Set<string>()
    const categories: { slug: string; title: string }[] = []

    for (const p of products) {
      const cat = p.main_category
      if (cat?.slug && !seen.has(cat.slug)) {
        seen.add(cat.slug)
        categories.push({ slug: cat.slug, title: cat.title_uk ?? cat.slug })
      }
    }

    categories.sort((a, b) => a.title.localeCompare(b.title, 'uk'))

    return NextResponse.json({ categories })
  } catch (err: any) {
    console.error('MauDau categories error:', err)
    return NextResponse.json({ categories: [], error: err.message }, { status: 500 })
  }
}

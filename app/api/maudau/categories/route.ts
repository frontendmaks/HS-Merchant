/**
 * GET /api/maudau/categories
 *
 * Returns MauDau categories.
 * Priority:
 *   1. maudau_categories table (populated by /api/maudau/import-categories)
 *   2. Fallback: extract unique categories from merchant's existing MauDau products
 */

import { getMaudauJwt, invalidateMaudauJwt } from '@/lib/maudau'
import { createServiceClient } from '@/lib/supabase/service'
import { NextResponse } from 'next/server'

async function fetchFromMaudauProducts(jwt: string): Promise<{ slug: string; title: string }[]> {
  const base = process.env.MAUDAU_BASE!
  const all: any[] = []
  let page = 1

  while (true) {
    const res = await fetch(
      `${base}/v1/merchant_public_api/products?per_page=100&page=${page}`,
      { headers: { Authorization: `Bearer ${jwt}` }, cache: 'no-store' }
    )
    if (!res.ok) throw new Error(`MauDau products: ${res.status}`)
    const data: any = await res.json()
    const items: any[] = data?.data ?? data ?? []
    all.push(...items)
    if (items.length < 100) break
    if (++page > 20) break
  }

  const seen = new Set<string>()
  const cats: { slug: string; title: string }[] = []
  for (const p of all) {
    const cat = p.main_category
    if (cat?.slug && !seen.has(cat.slug)) {
      seen.add(cat.slug)
      cats.push({ slug: cat.slug, title: cat.title_uk ?? cat.slug })
    }
  }
  return cats.sort((a, b) => a.title.localeCompare(b.title, 'uk'))
}

export async function GET() {
  try {
    const supabase = createServiceClient()

    // Priority 1: DB table (from Excel import)
    const { data: dbCats } = await supabase
      .from('maudau_categories')
      .select('slug, title')
      .order('title')

    if (dbCats && dbCats.length > 0) {
      return NextResponse.json({ categories: dbCats, source: 'db' })
    }

    // Priority 2: Live MauDau products API
    let jwt = await getMaudauJwt()
    let categories: { slug: string; title: string }[]
    try {
      categories = await fetchFromMaudauProducts(jwt)
    } catch (e: any) {
      if (e.message?.includes('401') || e.message?.includes('403')) {
        invalidateMaudauJwt()
        jwt = await getMaudauJwt()
        categories = await fetchFromMaudauProducts(jwt)
      } else {
        throw e
      }
    }

    return NextResponse.json({ categories, source: 'api' })
  } catch (err: any) {
    console.error('MauDau categories error:', err)
    return NextResponse.json({ categories: [], error: err.message }, { status: 500 })
  }
}

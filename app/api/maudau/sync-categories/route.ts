/**
 * POST /api/maudau/sync-categories
 *
 * Scrapes MauDau's public sitemap to get all category slugs,
 * then fetches each category page to extract the Ukrainian title (H1).
 * Results are upserted into maudau_categories table.
 *
 * Runs in batches of 10 parallel requests to avoid overloading MauDau.
 */

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

const MAUDAU = 'https://maudau.com.ua'
const SITEMAP_URL = `${MAUDAU}/sitemap_category_uk.xml`

async function fetchSitemapSlugs(): Promise<string[]> {
  const res = await fetch(SITEMAP_URL, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Sitemap fetch failed: ${res.status}`)
  const xml = await res.text()

  // Extract URLs from <loc> tags
  const matches = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
  const slugs: string[] = []

  for (const m of matches) {
    const url = m[1].trim()
    // Match /category/some-slug or /category/some-slug/
    const match = url.match(/\/category\/([^/?#]+)\/?$/)
    if (match) slugs.push(match[1])
  }

  return [...new Set(slugs)]
}

async function fetchCategoryTitle(slug: string): Promise<{ slug: string; title: string } | null> {
  try {
    const res = await fetch(`${MAUDAU}/category/${slug}`, {
      cache: 'no-store',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; bot/1.0)' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const html = await res.text()

    // Try to extract H1
    const h1 = html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]?.trim()
    if (h1) return { slug, title: h1 }

    // Fallback: og:title or title tag
    const og = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)?.[1]?.trim()
    if (og) {
      // og:title is usually "Назва категорії купити ..." — take just the first part
      const title = og.split(' купити')[0].split(' |')[0].trim()
      if (title) return { slug, title }
    }

    return null
  } catch {
    return null
  }
}

async function batchFetch(
  slugs: string[],
  fn: (slug: string) => Promise<{ slug: string; title: string } | null>,
  batchSize = 10
): Promise<{ slug: string; title: string }[]> {
  const results: { slug: string; title: string }[] = []
  for (let i = 0; i < slugs.length; i += batchSize) {
    const batch = slugs.slice(i, i + batchSize)
    const batchResults = await Promise.all(batch.map(fn))
    for (const r of batchResults) {
      if (r !== null) results.push(r)
    }
  }
  return results
}

export async function POST() {
  try {
    // 1. Get all slugs from sitemap
    const slugs = await fetchSitemapSlugs()
    if (slugs.length === 0) {
      return NextResponse.json({ success: false, error: 'No slugs found in sitemap' }, { status: 500 })
    }

    // 2. Fetch titles in batches of 10
    const categories = await batchFetch(slugs, fetchCategoryTitle, 10)

    if (categories.length === 0) {
      return NextResponse.json({ success: false, error: 'Could not fetch any category titles' }, { status: 500 })
    }

    // 3. Upsert into DB
    const supabase = createServiceClient()
    const { error } = await supabase
      .from('maudau_categories')
      .upsert(
        categories.map(c => ({ slug: c.slug, title: c.title, parent_slug: null })),
        { onConflict: 'slug' }
      )

    if (error) throw error

    return NextResponse.json({ success: true, count: categories.length, total_slugs: slugs.length })
  } catch (err: any) {
    console.error('sync-categories error:', err)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}

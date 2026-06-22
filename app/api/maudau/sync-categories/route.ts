/**
 * POST /api/maudau/sync-categories
 *
 * Upserts the static MauDau category seed list into maudau_categories table.
 * (Previous approach of scraping maudau.com.ua sitemap returned 403 from Vercel servers.)
 */

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { MAUDAU_CATEGORIES_SEED } from '@/lib/maudau-categories-seed'

export async function POST() {
  try {
    const supabase = createServiceClient()
    const { error } = await supabase
      .from('maudau_categories')
      .upsert(
        MAUDAU_CATEGORIES_SEED.map(c => ({ slug: c.slug, title: c.title, parent_slug: null })),
        { onConflict: 'slug' }
      )

    if (error) throw error

    return NextResponse.json({ success: true, count: MAUDAU_CATEGORIES_SEED.length })
  } catch (err: any) {
    console.error('sync-categories error:', err)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}

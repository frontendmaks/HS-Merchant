/**
 * GET /api/maudau/categories
 *
 * Returns MauDau categories.
 * Priority:
 *   1. maudau_categories table (if already populated)
 *   2. Auto-seeds from static list and returns it
 */

import { createServiceClient } from '@/lib/supabase/service'
import { MAUDAU_CATEGORIES_SEED } from '@/lib/maudau-categories-seed'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const supabase = createServiceClient()

    // Priority 1: DB table
    const { data: dbCats } = await supabase
      .from('maudau_categories')
      .select('slug, title')
      .order('title')

    if (dbCats && dbCats.length > 0) {
      return NextResponse.json({ categories: dbCats, source: 'db' })
    }

    // Auto-seed from static list if DB is empty
    await supabase
      .from('maudau_categories')
      .upsert(
        MAUDAU_CATEGORIES_SEED.map(c => ({ slug: c.slug, title: c.title, parent_slug: null })),
        { onConflict: 'slug' }
      )

    const sorted = [...MAUDAU_CATEGORIES_SEED].sort((a, b) => a.title.localeCompare(b.title, 'uk'))
    return NextResponse.json({ categories: sorted, source: 'seed' })
  } catch (err: any) {
    console.error('MauDau categories error:', err)
    return NextResponse.json({ categories: [], error: err.message }, { status: 500 })
  }
}

/**
 * POST /api/rozetka/sync-categories
 *
 * Refreshes rozetka_categories from the Rozetka API. Roughly 4700 categories
 * over 48 pages, which is why this is a deliberate button rather than something
 * the editor does on load.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { rozetkaAllCategories } from '@/lib/rozetka-api'

export const maxDuration = 60

export async function POST() {
  try {
    const cats = await rozetkaAllCategories()
    if (!cats.length) {
      return NextResponse.json({ success: false, error: 'Rozetka повернула порожній список' }, { status: 502 })
    }

    const supabase = createServiceClient()
    const now = new Date().toISOString()

    // Chunked: one statement with 4700 rows is refused
    for (let i = 0; i < cats.length; i += 500) {
      const { error } = await supabase.from('rozetka_categories').upsert(
        cats.slice(i, i + 500).map(c => ({
          id: c.id,
          title: c.title,
          title_ru: c.title_ru,
          parent_id: c.parent_id,
          level: c.level,
          mpath: c.mpath,
          is_vendor_required: c.is_vendor_required,
          updated_at: now,
        })),
        { onConflict: 'id' },
      )
      if (error) throw error
    }

    return NextResponse.json({ success: true, count: cats.length })
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 })
  }
}

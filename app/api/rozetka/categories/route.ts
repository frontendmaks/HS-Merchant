/**
 * GET /api/rozetka/categories
 *
 * Rozetka's category tree, served from rozetka_categories the way
 * /api/maudau/categories serves maudau_categories. There are ~4700 of them
 * over 48 API pages, so the editor reads the local copy and a separate sync
 * refreshes it.
 *
 *   ?title=ковбас  narrows by name (locally; falls back to the API if the
 *                  table has not been synced yet)
 *   ?leaf=1        only categories products can actually be filed under
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { rozetkaSearchCategories } from '@/lib/rozetka-api'

export async function GET(req: NextRequest) {
  try {
    const title = req.nextUrl.searchParams.get('title')?.trim() ?? ''
    const leafOnly = req.nextUrl.searchParams.get('leaf') === '1'
    const supabase = createServiceClient()

    let q = supabase
      .from('rozetka_categories')
      .select('id, title, parent_id, level, mpath, is_vendor_required, attributes')
      .order('title')
      .limit(500)

    if (title) q = q.ilike('title', `%${title}%`)
    // A parent category takes no products, so offer only the deepest levels
    if (leafOnly) q = q.gte('level', 4)

    const { data, error } = await q
    if (error) throw error

    if (data && data.length) {
      return NextResponse.json({ success: true, categories: data, source: 'db' })
    }

    // Table not synced yet — answer from the API so the editor still works
    const live = title ? await rozetkaSearchCategories(title) : []
    return NextResponse.json({
      success: true,
      categories: live,
      source: live.length ? 'api' : 'empty',
      hint: live.length ? undefined : 'Категорії ще не завантажені — натисніть «Оновити категорії»',
    })
  } catch (e) {
    return NextResponse.json(
      { success: false, categories: [], error: (e as Error).message },
      { status: 500 },
    )
  }
}

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

    // Compact on purpose: the picker holds all 4712 at once to filter locally,
    // and the wide columns would turn 150KB into megabytes.
    const page = async (from: number) => {
      let q = supabase
        .from('rozetka_categories')
        .select('id, title, level, is_vendor_required')
        .order('title')
        .range(from, from + 999)
      if (title) q = q.ilike('title', `%${title}%`)
      if (leafOnly) q = q.gte('level', 4)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    }

    const data: { id: number; title: string; level: number | null; is_vendor_required: boolean }[] = []
    for (let from = 0; ; from += 1000) {
      const rows = await page(from)
      data.push(...rows)
      if (rows.length < 1000) break
    }

    if (data.length) {
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

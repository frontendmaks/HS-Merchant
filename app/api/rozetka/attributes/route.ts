/**
 * GET  /api/rozetka/attributes?category_id=xxx
 *   What that Rozetka category asks of a product, with the allowed values for
 *   its list-type fields. Cached on the category row — the values need one
 *   request each, so refetching on every keystroke is not an option.
 *
 * POST /api/rozetka/attributes  { category_id }
 *   Forces a refresh of that cache.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { rozetkaAttributes } from '@/lib/rozetka-api'

export const maxDuration = 60

async function load(categoryId: number, force: boolean) {
  const supabase = createServiceClient()

  if (!force) {
    const { data } = await supabase
      .from('rozetka_categories')
      .select('attributes')
      .eq('id', categoryId)
      .maybeSingle()
    if (data?.attributes) return { attributes: data.attributes, source: 'cache' as const }
  }

  const attributes = await rozetkaAttributes(categoryId)
  await supabase
    .from('rozetka_categories')
    .update({ attributes, attributes_synced_at: new Date().toISOString() })
    .eq('id', categoryId)

  return { attributes, source: 'api' as const }
}

export async function GET(req: NextRequest) {
  try {
    const categoryId = Number(req.nextUrl.searchParams.get('category_id') ?? 0)
    if (!categoryId) return NextResponse.json({ error: 'category_id required' }, { status: 400 })
    return NextResponse.json({ success: true, ...(await load(categoryId, false)) })
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { category_id } = await req.json() as { category_id?: number }
    if (!category_id) return NextResponse.json({ error: 'category_id required' }, { status: 400 })
    return NextResponse.json({ success: true, ...(await load(Number(category_id), true)) })
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 })
  }
}

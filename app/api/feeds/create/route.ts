import { createServiceClient } from '@/lib/supabase/service'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const supabase = createServiceClient()
  try {
    const { name, slug, marketplace_id, custom_marketplace_name } = await request.json()

    if (!name || !slug || (!marketplace_id && !custom_marketplace_name)) {
      return NextResponse.json({ success: false, error: 'Missing fields' }, { status: 400 })
    }

    let resolvedMarketplaceId = marketplace_id
    if (!marketplace_id && custom_marketplace_name) {
      const slug_mp = custom_marketplace_name.toLowerCase()
        .replace(/[^a-z0-9а-яіїєёА-ЯІЇЄЁa-zA-Z0-9]/g, '-').replace(/^-|-$/g, '') || 'custom'
      const { data: existing } = await supabase
        .from('marketplaces').select('id').eq('name', custom_marketplace_name).maybeSingle()
      if (existing) {
        resolvedMarketplaceId = existing.id
      } else {
        const { data: created, error: mpErr } = await supabase
          .from('marketplaces').insert({ name: custom_marketplace_name, slug: slug_mp }).select('id').single()
        if (mpErr) throw mpErr
        resolvedMarketplaceId = created.id
      }
    }

    const { data, error } = await supabase
      .from('feeds')
      .insert({
        name,
        slug,
        marketplace_id: resolvedMarketplaceId,
        status: 'draft',
        settings: { trigger: 'manual', filter: { type: 'all', categories: [] } },
      })
      .select('id')
      .single()

    if (error) throw error

    return NextResponse.json({ success: true, id: data.id })
  } catch (err: any) {
    console.error('Feed create error:', err)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}

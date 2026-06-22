import { createServiceClient } from '@/lib/supabase/service'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const supabase = createServiceClient()
  try {
    const { name, slug, marketplace_id } = await request.json()

    if (!name || !slug || !marketplace_id) {
      return NextResponse.json({ success: false, error: 'Missing fields' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('feeds')
      .insert({
        name,
        slug,
        marketplace_id,
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

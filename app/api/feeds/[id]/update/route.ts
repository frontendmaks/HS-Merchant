import { createServiceClient } from '@/lib/supabase/service'
import { NextResponse } from 'next/server'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createServiceClient()

  try {
    const body = await request.json()
    const { name, slug, status, settings, overrides } = body

    // Update feed settings
    const { error: feedError } = await supabase
      .from('feeds')
      .update({ name, slug, status, settings, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (feedError) throw feedError

    // Upsert product overrides
    if (overrides && Object.keys(overrides).length > 0) {
      const rows = Object.entries(overrides).map(([product_id, ov]: [string, any]) => ({
        feed_id: id,
        product_id,
        is_active: ov.is_active ?? true,
        custom_price: ov.custom_price !== '' && ov.custom_price != null ? Number(ov.custom_price) : null,
        custom_stock: ov.custom_stock !== '' && ov.custom_stock != null ? Number(ov.custom_stock) : null,
        custom_name: ov.custom_name ?? null,
      }))

      const { error: fpError } = await supabase
        .from('feed_products')
        .upsert(rows, { onConflict: 'feed_id,product_id' })

      if (fpError) throw fpError
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('Feed update error:', err)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}

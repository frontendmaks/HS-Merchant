/** Putting a withdrawn product back on sale. Admin only, same as deciding. */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor } from '@/lib/order-events'
import { getCurrentRole } from '@/lib/getRole'
import { canDecideRemoval } from '@/lib/product-removal'

export async function POST(req: NextRequest) {
  const actor = await currentActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canDecideRemoval(await getCurrentRole())) {
    return NextResponse.json({ error: 'Немає прав' }, { status: 403 })
  }

  const { productIds } = await req.json() as { productIds?: string[] }
  const ids = [...new Set((productIds ?? []).filter(Boolean))]
  if (!ids.length) return NextResponse.json({ error: 'Оберіть товари' }, { status: 400 })

  const supabase = createServiceClient()

  const { data: products } = await supabase
    .from('products').select('id, withdrawn_feed_ids').in('id', ids)

  const now = new Date().toISOString()

  // Back into the feeds it was taken out of, one product at a time — each was
  // in its own set of them
  for (const p of products ?? []) {
    const feedIds = (p.withdrawn_feed_ids as string[] | null) ?? []
    if (!feedIds.length) continue
    const { error } = await supabase
      .from('feed_products')
      .update({ is_active: true, updated_at: now })
      .eq('product_id', p.id)
      .in('feed_id', feedIds)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const { error } = await supabase
    .from('products')
    .update({
      withdrawn_at: null, withdrawn_by: null, withdrawn_reason: null,
      withdrawn_feed_ids: null, updated_at: now,
    })
    .in('id', ids)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, restored: ids.length })
}

export const dynamic = 'force-dynamic'

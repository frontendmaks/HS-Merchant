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
  const { error } = await supabase
    .from('products')
    .update({
      withdrawn_at: null, withdrawn_by: null, withdrawn_reason: null,
      updated_at: new Date().toISOString(),
    })
    .in('id', ids)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // The offer was never removed, so it simply starts selling again with the
  // next feed fetch — nothing to re-create on the marketplace
  return NextResponse.json({ ok: true, restored: ids.length })
}

export const dynamic = 'force-dynamic'

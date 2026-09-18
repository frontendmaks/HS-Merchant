import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor } from '@/lib/order-events'
import { getCurrentRole, canAccess } from '@/lib/getRole'
import { isMatchMode } from '@/lib/price-monitor'

async function guard() {
  const actor = await currentActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canAccess('priceMonitor', await getCurrentRole())) {
    return NextResponse.json({ error: 'Немає доступу' }, { status: 403 })
  }
  return actor
}

export async function POST(req: NextRequest) {
  const actor = await guard()
  if (actor instanceof NextResponse) return actor

  const { productIds, mode } = await req.json() as { productIds: string[]; mode?: string }
  const ids = [...new Set((productIds ?? []).filter(Boolean))]
  if (!ids.length) return NextResponse.json({ error: 'Оберіть товар' }, { status: 400 })

  const match_mode = isMatchMode(mode) ? mode : 'similar'

  const { error } = await createServiceClient()
    .from('price_watches')
    .upsert(ids.map(id => ({ product_id: id, added_by: actor.id, match_mode })),
            { onConflict: 'product_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, added: ids.length })
}

/** Changing how strictly one product is matched. */
export async function PATCH(req: NextRequest) {
  const actor = await guard()
  if (actor instanceof NextResponse) return actor

  const { productIds, mode } = await req.json() as { productIds: string[]; mode: string }
  if (!isMatchMode(mode)) {
    return NextResponse.json({ error: 'Невідомий режим' }, { status: 400 })
  }
  const ids = [...new Set((productIds ?? []).filter(Boolean))]
  if (!ids.length) return NextResponse.json({ error: 'Оберіть товар' }, { status: 400 })

  const service = createServiceClient()
  const { error } = await service
    .from('price_watches').update({ match_mode: mode }).in('product_id', ids)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // The stored matches were judged under the old rule, so they no longer mean
  // what the new setting says. Cleared rather than left to look current.
  await service.from('price_matches')
    .delete().in('product_id', ids).eq('status', 'auto')

  return NextResponse.json({ ok: true, updated: ids.length })
}

export async function DELETE(req: NextRequest) {
  const actor = await guard()
  if (actor instanceof NextResponse) return actor

  const id = req.nextUrl.searchParams.get('product_id') ?? ''
  const { error } = await createServiceClient()
    .from('price_watches').delete().eq('product_id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

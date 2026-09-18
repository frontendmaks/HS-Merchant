import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor } from '@/lib/order-events'
import { getCurrentRole, canAccess } from '@/lib/getRole'

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

  const { productIds } = await req.json() as { productIds: string[] }
  const ids = [...new Set((productIds ?? []).filter(Boolean))]
  if (!ids.length) return NextResponse.json({ error: 'Оберіть товар' }, { status: 400 })

  const { error } = await createServiceClient()
    .from('price_watches')
    .upsert(ids.map(id => ({ product_id: id, added_by: actor.id })),
            { onConflict: 'product_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, added: ids.length })
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

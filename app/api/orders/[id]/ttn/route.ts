import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor, logOrderEvent } from '@/lib/order-events'
import { pushTtnToMarketplace } from '@/lib/marketplace-ttn'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const { ttn, platform, external_id } = (await req.json()) as {
    ttn: string
    platform: string
    external_id: string
  }

  const supabase = createServiceClient()

  const { data: before } = await supabase
    .from('orders').select('ttn, status').eq('id', id).single()

  const { error: dbError } = await supabase
    .from('orders')
    .update({ ttn, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (dbError) return NextResponse.json({ success: false, error: dbError.message }, { status: 500 })

  if ((before?.ttn ?? null) !== (ttn || null)) {
    await logOrderEvent(supabase, id, 'ttn',
      { old: before?.ttn ?? null, new: ttn || null }, await currentActor())
  }

  const pushed = await pushTtnToMarketplace(platform, external_id, ttn)
  if (!pushed.ok) {
    return NextResponse.json({ success: false, error: pushed.error }, { status: 500 })
  }

  // Handing the number over is what marks the order shipped, so record the
  // status the marketplace just moved it to rather than leaving ours stale
  if (pushed.status && pushed.status !== before?.status) {
    await supabase.from('orders')
      .update({ status: pushed.status, updated_at: new Date().toISOString() })
      .eq('id', id)
    await logOrderEvent(supabase, id, 'status',
      { old: before?.status ?? null, new: pushed.status, details: 'разом із ТТН' },
      await currentActor())
  }

  return NextResponse.json({ success: true, status: pushed.status })
}

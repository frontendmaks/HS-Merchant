import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor, logOrderEvent } from '@/lib/order-events'
import { pushTtnToMarketplace } from '@/lib/marketplace-ttn'
import { broadcastOrderChange } from '@/lib/order-broadcast'
import { isHandedOver } from '@/lib/order-statuses'
import { readDestination } from '@/lib/order-delivery'

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

  // A parcel already with the courier is driven by the marketplace from here
  const { data: current } = await supabase
    .from('orders').select('status, ttn').eq('id', id).single()
  if (isHandedOver(current?.status as string, current?.ttn as string)) {
    return NextResponse.json(
      { success: false, error: 'Замовлення вже в доставці — ТТН не змінюється' },
      { status: 409 },
    )
  }

  const { data: before } = await supabase
    .from('orders').select('ttn, status, raw').eq('id', id).single()
  // Delivered by the shop itself: the marketplace refuses a number for these,
  // so the row keeps it and nothing is sent
  const byMerchant = readDestination(
    before?.raw as Record<string, unknown> | null).byMerchant

  const { error: dbError } = await supabase
    .from('orders')
    .update({ ttn, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (dbError) return NextResponse.json({ success: false, error: dbError.message }, { status: 500 })

  if ((before?.ttn ?? null) !== (ttn || null)) {
    await logOrderEvent(supabase, id, 'ttn',
      { old: before?.ttn ?? null, new: ttn || null }, await currentActor())
  }

  if (byMerchant) {
    await broadcastOrderChange(id, 'ttn')
    return NextResponse.json({
      success: true,
      note: 'Доставка продавця — маркетплейс не приймає ТТН, номер збережено лише в нас.',
    })
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

  await broadcastOrderChange(id, 'ttn')
  return NextResponse.json({ success: true, status: pushed.status })
}

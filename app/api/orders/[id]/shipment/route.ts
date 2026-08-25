import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor, logOrderEvent } from '@/lib/order-events'
import { shipmentWeight, type OrderLine } from '@/lib/order-items'

// GET — what would go on the waybill, computed from the corrected lines
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await currentActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const service = createServiceClient()

  const [{ data: order }, { data: items }, { data: settings }] = await Promise.all([
    service.from('orders')
      .select('external_id, customer_name, customer_phone, branch, address, total, weight, seats_amount, ttn, np_ttn_ref, raw')
      .eq('id', id).single(),
    service.from('order_items').select('*').eq('order_id', id).order('position'),
    service.from('np_settings').select('*').eq('id', true).maybeSingle(),
  ])

  if (!order) return NextResponse.json({ error: 'Замовлення не знайдено' }, { status: 404 })

  const lines = (items ?? []) as unknown as OrderLine[]
  const computed = shipmentWeight(lines)

  // Nova Poshta wants its own refs for the recipient's city and branch. MauDau
  // passes them straight through, so no lookup is needed.
  const raw = order.raw as Record<string, unknown> | null
  const delivery = (raw?.delivery_address ?? {}) as Record<string, unknown>
  const city = (delivery.city ?? {}) as Record<string, unknown>
  const warehouse = (delivery.warehouse ?? {}) as Record<string, unknown>
  const cityRef = (city.external_ids as { id?: string }[] | undefined)?.[0]?.id ?? null
  const warehouseRef = (warehouse.external_id as string | undefined) ?? null

  return NextResponse.json({
    order: {
      external_id: order.external_id,
      recipient: order.customer_name,
      phone: order.customer_phone,
      branch: order.branch,
      address: order.address,
      cost: Number(order.total ?? 0),
      ttn: order.ttn,
    },
    weight: {
      computed: computed.kg,
      assumed: computed.assumed,
      saved: order.weight != null ? Number(order.weight) : null,
    },
    seats: order.seats_amount ?? 1,
    recipientRefs: { cityRef, warehouseRef },
    // Without these a waybill cannot be created, so the UI can say which is missing
    ready: {
      apiKey: !!process.env.NOVA_POSHTA_API_KEY,
      sender: !!settings?.sender_ref,
      cityRef: !!cityRef,
      warehouseRef: !!warehouseRef,
    },
  })
}

// PATCH — store the weight and seat count an operator settled on
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await currentActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { weight, seats } = await req.json() as { weight?: number; seats?: number }

  const service = createServiceClient()
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (weight != null && Number.isFinite(weight)) updates.weight = weight
  if (seats != null && Number.isFinite(seats)) updates.seats_amount = Math.max(1, Math.round(seats))

  const { error } = await service.from('orders').update(updates).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logOrderEvent(service, id, 'shipment',
    { new: `вага ${weight} кг · місць ${updates.seats_amount ?? 1}` }, actor)

  return NextResponse.json({ ok: true })
}

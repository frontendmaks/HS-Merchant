import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor, logOrderEvent } from '@/lib/order-events'
import { shipmentWeight, orderTotals, type OrderLine } from '@/lib/order-items'
import {
  CELL_PRESETS, cityRefByName, createWaybill, hasNpKey, senderWarehouses,
  warehouseLimits, type NpSettings,
} from '@/lib/nova-poshta'
import { pushTtnNumber } from '@/lib/marketplace-ttn'
import { broadcastOrderChange } from '@/lib/order-broadcast'
import { canCreateWaybill, isHandedOver } from '@/lib/order-statuses'
import { readDestination } from '@/lib/order-delivery'

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
      .select('external_id, customer_name, customer_phone, branch, address, total, weight, seats_amount, ttn, np_ttn_ref, status, raw')
      .eq('id', id).single(),
    service.from('order_items').select('*').eq('order_id', id).order('position'),
    service.from('np_settings').select('*').eq('id', true).maybeSingle(),
  ])

  if (!order) return NextResponse.json({ error: 'Замовлення не знайдено' }, { status: 404 })

  const lines = (items ?? []) as unknown as OrderLine[]
  const computed = shipmentWeight(lines)
  const totals = orderTotals(lines)

  // The waybill insures what is actually in the box, so the corrected sum wins
  const declared = lines.length ? totals.corrected : Number(order.total ?? 0)

  // Nova Poshta wants its own ref for the recipient's city. A branch order
  // carries one; inside MauDau's courier zone only the name comes over, so
  // that case is resolved against Nova Poshta here.
  const dest = readDestination(
    order.raw as Record<string, unknown> | null, order.branch as string | null)
  const { warehouseRef, toBranch, toPostomat } = dest
  const street = dest.street ?? undefined
  const building = dest.building ?? undefined
  const flat = dest.flat ?? undefined

  let cityRef = dest.cityRef
  let cityNote: string | null = null
  if (!cityRef && dest.cityName && hasNpKey()) {
    const found = await cityRefByName(dest.cityName)
    if (found.ok) {
      cityRef = found.ref
      cityNote = `Місто визначено за назвою: ${found.present}`
    } else {
      cityNote = found.error
    }
  }

  // Dispatch branch can change day to day, so the operator picks it
  const branches = hasNpKey() && settings?.city_sender_ref
    ? await senderWarehouses(settings.city_sender_ref)
    : []

  // Lockers differ from one another, so ask this one what it takes
  const limits = toPostomat && hasNpKey() && warehouseRef
    ? await warehouseLimits(warehouseRef)
    : null

  return NextResponse.json({
    delivery: {
      toBranch, toPostomat,
      street: street ?? null, building: building ?? null, flat: flat ?? null,
    },
    cells: toPostomat ? CELL_PRESETS : [],
    limits,
    sender: {
      current: settings?.sender_address_ref ?? null,
      branches,
    },
    order: {
      external_id: order.external_id,
      recipient: order.customer_name,
      phone: order.customer_phone,
      branch: order.branch,
      address: order.address,
      cost: declared,
      originalCost: Number(order.total ?? 0),
      ttn: order.ttn,
    },
    weight: {
      computed: computed.kg,
      assumed: computed.assumed,
      saved: order.weight != null ? Number(order.weight) : null,
    },
    seats: order.seats_amount ?? 1,
    recipientRefs: { cityRef, warehouseRef },
    // Says whether the city was matched for us, or why it could not be
    cityNote,
    // Without these a waybill cannot be created, so the UI can say which is missing
    // Agreed and not yet shipped: the point at which the contents are settled
    readyToShip: canCreateWaybill(order.status as string, order.ttn as string),
    status: order.status,
    ready: {
      apiKey: hasNpKey(),
      sender: !!settings?.sender_ref,
      cityRef: !!cityRef,
      // Courier orders need a street instead of a branch
      destination: toBranch || !!(street && building),
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


// POST — create the waybill at Nova Poshta and store its number on the order
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await currentActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { weight, seats, description, senderAddressRef, dimensions } = await req.json() as {
    weight?: number
    seats?: number
    description?: string
    senderAddressRef?: string
    dimensions?: { length?: number; width?: number; height?: number }
  }

  const service = createServiceClient()
  const [{ data: order }, { data: settings }, { data: items }] = await Promise.all([
    service.from('orders')
      .select('customer_name, customer_phone, total, ttn, np_ttn_ref, raw, platform, external_id, status')
      .eq('id', id).single(),
    service.from('np_settings').select('*').eq('id', true).maybeSingle(),
    service.from('order_items').select('*').eq('order_id', id),
  ])

  if (!order) return NextResponse.json({ error: 'Замовлення не знайдено' }, { status: 404 })
  if (order.ttn) {
    return NextResponse.json({ error: `ТТН вже створено: ${order.ttn}` }, { status: 400 })
  }
  if (isHandedOver(order.status as string, order.ttn as string)) {
    return NextResponse.json(
      { error: 'Замовлення вже передано в доставку' }, { status: 409 })
  }
  if (!canCreateWaybill(order.status as string, order.ttn as string)) {
    return NextResponse.json(
      { error: `ТТН створюється лише з погодженого замовлення — зараз «${order.status}»` },
      { status: 409 },
    )
  }
  if (!hasNpKey()) return NextResponse.json({ error: 'NOVA_POSHTA_API_KEY не налаштовано' }, { status: 400 })
  if (!settings?.sender_ref) {
    return NextResponse.json({ error: 'Не заповнені дані відправника' }, { status: 400 })
  }

  const dest = readDestination(order.raw as Record<string, unknown> | null)

  // Same resolution the dialog did when it enabled the button — repeated
  // rather than trusted, since the client is free to send anything
  let cityRef = dest.cityRef
  if (!cityRef && dest.cityName) {
    const found = await cityRefByName(dest.cityName)
    if (!found.ok) return NextResponse.json({ error: found.error }, { status: 400 })
    cityRef = found.ref
  }

  // Insure the corrected value — what actually goes in the box
  const lines = (items ?? []) as unknown as OrderLine[]
  const declaredValue = lines.length
    ? orderTotals(lines).corrected
    : Number(order.total ?? 0)

  const result = await createWaybill(settings as NpSettings, {
    recipientName: order.customer_name ?? '',
    recipientPhone: order.customer_phone ?? '',
    cityRecipientRef: cityRef ?? '',
    warehouseRecipientRef: dest.warehouseRef,
    street: dest.street ?? undefined,
    building: dest.building ?? undefined,
    flat: dest.flat,
    weightKg: Number(weight) || 1,
    seats: Number(seats) || 1,
    cost: declaredValue,
    description,
    senderAddressRef,
    dimensions,
    toPostomat: dest.toPostomat,
  })

  if (!result.ok) {
    await service.from('orders').update({ np_error: result.error }).eq('id', id)
    await logOrderEvent(service, id, 'ttn', { new: `помилка НП: ${result.error}` }, actor)
    return NextResponse.json({ error: result.error }, { status: 502 })
  }

  await service.from('orders').update({
    ttn: result.ttn,
    np_ttn_ref: result.ref,
    ttn_created_at: new Date().toISOString(),
    np_error: null,
    weight: Number(weight) || null,
    seats_amount: Number(seats) || 1,
    updated_at: new Date().toISOString(),
  }).eq('id', id)

  await logOrderEvent(service, id, 'ttn',
    { new: `${result.ttn} · ${weight} кг · оцінка ₴${declaredValue} · доставка ${result.estimatedDelivery}` }, actor)

  // The number goes over at once — the buyer's tracking depends on it. The move
  // to shipped is a separate step the caller makes shortly after, so the dialog
  // can close on a saved waybill rather than waiting on the marketplace.
  const pushed = await pushTtnNumber(
    order.platform as string, order.external_id as string, result.ttn!)

  await broadcastOrderChange(id, 'ttn')

  return NextResponse.json({
    ...result,
    // The waybill exists either way; a failed handover is worth saying out loud
    marketplaceError: pushed.ok ? undefined : pushed.error,
  })
}

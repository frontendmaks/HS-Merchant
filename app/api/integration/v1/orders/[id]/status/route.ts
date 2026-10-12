import { NextRequest, NextResponse } from 'next/server'
import { authorize, isDenied, logRequest, replayed, remember } from '@/lib/integration-auth'
import { isHandedOver, requiresPayment } from '@/lib/order-statuses'
import { logOrderEvent } from '@/lib/order-events'
import { broadcastOrderChange } from '@/lib/order-broadcast'
import { notifyIntegrations } from '@/lib/integration-webhooks'

/**
 * PATCH /api/integration/v1/orders/{id}/status
 *
 * Зміна статусу ззовні.
 *
 * Правила Мерчанта діють так само, як для операторів, і це навмисно: правило,
 * яке можна обійти одним із входів, — не правило. Зокрема неоплачене
 * замовлення не поїде, хоч би хто його відправляв.
 *
 * Скасування сюди не входить: воно вимагає причини й окремого шляху до
 * маркетплейсу. Скасовують у Мерчанті.
 *
 *   { "status": "Узгоджено" }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const started = Date.now()
  const auth = await authorize(req, 'orders:status')
  if (isDenied(auth)) return auth.response

  const { client, service } = auth
  const { id } = await params
  const idemKey = req.headers.get('idempotency-key')

  const cached = await replayed(service, client.id, idemKey)
  if (cached) return cached

  const { status } = await req.json().catch(() => ({})) as { status?: string }
  if (!status?.trim()) {
    await logRequest(service, client.id, req, 400, started, 'no status')
    return NextResponse.json({ error: 'Вкажіть status' }, { status: 400 })
  }

  if (status === 'Скасовано') {
    await logRequest(service, client.id, req, 403, started, 'cancel via api')
    return NextResponse.json(
      { error: 'Скасування потребує причини — робиться в Мерчанті' }, { status: 403 })
  }

  const isUuid = /^[0-9a-f-]{36}$/i.test(id)
  const { data: order } = await service.from('orders')
    .select('id, status, ttn, is_paid, platform, external_id')
    .eq(isUuid ? 'id' : 'external_id', id).maybeSingle()

  if (!order) {
    await logRequest(service, client.id, req, 404, started)
    return NextResponse.json({ error: 'Замовлення не знайдено' }, { status: 404 })
  }

  if (isHandedOver(order.status as string, order.ttn as string)) {
    await logRequest(service, client.id, req, 409, started, 'handed over')
    return NextResponse.json(
      { error: 'Замовлення вже в доставці — статус не змінюється' }, { status: 409 })
  }

  if (requiresPayment(status) && !order.is_paid) {
    await logRequest(service, client.id, req, 409, started, 'unpaid')
    return NextResponse.json(
      { error: 'Замовлення не оплачене — спершу має бути позначена передоплата' },
      { status: 409 })
  }

  // Статус у маркетплейс штовхає наш внутрішній маршрут: він знає відмінності
  // MauDau і Rozetka, і дублювати це знання тут означало б мати дві правди
  const origin = new URL(req.url).origin
  const push = await fetch(`${origin}/api/orders/${order.id}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-Integration-Client': client.id,
    },
    body: JSON.stringify({
      status, platform: order.platform, external_id: order.external_id,
    }),
  }).catch(() => null)

  const result = await push?.json().catch(() => null) as { success?: boolean; error?: string } | null

  if (!push?.ok || !result?.success) {
    const message = result?.error ?? 'Маркетплейс не прийняв статус'
    await logRequest(service, client.id, req, 502, started, message)
    return NextResponse.json({ error: message }, { status: 502 })
  }

  await logOrderEvent(service, order.id as string, 'status',
    { old: order.status as string, new: status },
    { id: client.id, name: `${client.name} (інтеграція)` })

  await broadcastOrderChange(order.id as string, 'status')
  await notifyIntegrations(order.id as string, 'order.status_changed', service)

  const response = { ok: true, status }
  await remember(service, client.id, idemKey, response)
  await logRequest(service, client.id, req, 200, started)
  return NextResponse.json(response)
}

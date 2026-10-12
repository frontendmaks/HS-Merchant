import { NextRequest, NextResponse } from 'next/server'
import { authorize, isDenied, logRequest, replayed, remember } from '@/lib/integration-auth'
import { isHandedOver, requiresPayment } from '@/lib/order-statuses'
import { changeOrderStatus } from '@/lib/order-status-change'

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

  // Та сама функція, що й в інтерфейсу: правила, журнал і штовхання в
  // маркетплейс там усередині. Раніше тут був запит по HTTP до власного ж
  // маршруту — зайвий стрибок, який до того ж ламався, щойно той маршрут
  // почав вимагати автентифікації.
  const result = await changeOrderStatus({
    id: order.id as string,
    status,
    platform: order.platform as string,
    external_id: order.external_id as string,
    actor: { id: client.id, name: `${client.name} (інтеграція)` },
  })

  if (!result.ok) {
    const payload = await result.json().catch(() => ({})) as { error?: string }
    await logRequest(service, client.id, req, result.status, started, payload.error)
    return NextResponse.json(
      { error: payload.error ?? 'Не вдалося змінити статус' }, { status: result.status })
  }

  const response = { ok: true, status }
  await remember(service, client.id, idemKey, response)
  await logRequest(service, client.id, req, 200, started)
  return NextResponse.json(response)
}

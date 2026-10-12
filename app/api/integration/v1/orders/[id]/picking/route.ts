import { NextRequest, NextResponse } from 'next/server'
import { authorize, isDenied, logRequest, replayed, remember } from '@/lib/integration-auth'
import { buildOrders, ORDER_FIELDS } from '@/lib/integration-order'
import { logOrderEvent } from '@/lib/order-events'
import { orderTotals, shipmentWeight, type OrderLine } from '@/lib/order-items'
import { broadcastOrderChange } from '@/lib/order-broadcast'
import { notifyIntegrations } from '@/lib/integration-webhooks'
import { canRecordPicking } from '@/lib/order-statuses'

/**
 * POST /api/integration/v1/orders/{id}/picking
 *
 * Результат комплектації: скільки чого зібрано насправді.
 *
 * Рядки шукаються за номенклатурою 1С, а не за нашим внутрішнім id: 1С знає
 * товар за uid і кодом, і просити її тримати ще й наші ідентифікатори означало
 * б завести третій список, який розійдеться з двома іншими.
 *
 *   { "lines": [ { "uid_1c": "...", "actual_qty": 1.24 },
 *                { "code_1c": "НФ-00009045", "actual_qty": 0, "removed": true } ],
 *     "note": "Шпондера не було, замінили" }
 *
 * Суми, вага й комісія перераховуються тут — так само, як коли те саме робить
 * оператор у Мерчанті. Два шляхи до одного результату не повинні рахувати
 * по-різному.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const started = Date.now()
  const auth = await authorize(req, 'orders:write')
  if (isDenied(auth)) return auth.response

  const { client, service } = auth
  const { id } = await params
  const idemKey = req.headers.get('idempotency-key')

  const cached = await replayed(service, client.id, idemKey)
  if (cached) return cached

  const body = await req.json().catch(() => null) as {
    lines?: { uid_1c?: string; code_1c?: string; sku?: string; line_id?: string
              actual_qty?: number; removed?: boolean }[]
    note?: string
  } | null

  if (!body?.lines?.length) {
    await logRequest(service, client.id, req, 400, started, 'no lines')
    return NextResponse.json(
      { error: 'Передайте lines: перелік позицій із actual_qty' }, { status: 400 })
  }

  const isUuid = /^[0-9a-f-]{36}$/i.test(id)
  const { data: order } = await service.from('orders')
    .select('id, status, ttn, platform, external_id')
    .eq(isUuid ? 'id' : 'external_id', id)
    .maybeSingle()

  if (!order) {
    await logRequest(service, client.id, req, 404, started)
    return NextResponse.json({ error: 'Замовлення не знайдено' }, { status: 404 })
  }

  // Межа — передача кур'єру, а не узгодження.
  //
  // Спершу тут стояло правило редагування складу, яке зачиняється на
  // «Узгоджено». Але комплектація саме тоді й починається — маршрут відмовляв
  // би в єдиному стані, заради якого існує.
  if (!canRecordPicking(order.status as string, order.ttn as string)) {
    await logRequest(service, client.id, req, 409, started, 'picking closed')
    return NextResponse.json({
      error: order.status === 'Скасовано'
        ? 'Замовлення скасовано'
        : 'Замовлення вже передано кур\'єру — комплектація закрита',
    }, { status: 409 })
  }

  const { data: lines } = await service.from('order_items')
    .select('*').eq('order_id', order.id).order('position')

  const externalIds = (lines ?? []).map(l => l.product_external_id).filter(Boolean) as string[]
  const { data: products } = externalIds.length
    ? await service.from('products')
        .select('external_id, uid_1c, code_1c, sku').in('external_id', externalIds)
    : { data: [] }

  const byExternal = new Map((products ?? []).map(p => [p.external_id as string, p]))

  /** Знаходить наш рядок за тим, чим його назвала зовнішня система. */
  const locate = (want: { uid_1c?: string; code_1c?: string; sku?: string; line_id?: string }) =>
    (lines ?? []).find(l => {
      if (want.line_id && l.id === want.line_id) return true
      const p = l.product_external_id ? byExternal.get(l.product_external_id) : null
      if (!p) return false
      if (want.uid_1c && p.uid_1c === want.uid_1c) return true
      if (want.code_1c && p.code_1c === want.code_1c) return true
      if (want.sku && p.sku === want.sku) return true
      return false
    })

  const applied: Record<string, unknown>[] = []
  const unmatched: Record<string, unknown>[] = []
  const now = new Date().toISOString()

  for (const want of body.lines) {
    const line = locate(want)
    if (!line) { unmatched.push(want); continue }

    const qty = want.removed ? 0 : Number(want.actual_qty)
    if (!want.removed && (!Number.isFinite(qty) || qty < 0)) {
      unmatched.push({ ...want, reason: 'actual_qty має бути невід’ємним числом' })
      continue
    }

    await service.from('order_items').update({
      actual_qty: want.removed ? null : qty,
      removed: !!want.removed,
      updated_at: now,
    }).eq('id', line.id)

    applied.push({ line_id: line.id, title: line.title, actual_qty: qty, removed: !!want.removed })
  }

  // Перечитуємо й перераховуємо — щоб суми рахувались з того, що лягло в базу,
  // а не з того, що ми збирались туди покласти
  const { data: fresh } = await service.from('order_items')
    .select('*').eq('order_id', order.id).order('position')

  const totals = orderTotals((fresh ?? []) as unknown as OrderLine[])
  const weight = shipmentWeight((fresh ?? []) as unknown as OrderLine[])

  await service.from('orders').update({
    total: totals.corrected,
    weight: weight.kg,
    updated_at: now,
  }).eq('id', order.id)

  const actor = { id: client.id, name: `${client.name} (інтеграція)` }
  await logOrderEvent(service, order.id as string, 'items', {
    details: { applied, unmatched, total: totals.corrected, weight: weight.kg },
  }, actor)

  if (body.note?.trim()) {
    const { data: prev } = await service.from('orders')
      .select('operator_comment').eq('id', order.id).single()
    const merged = [prev?.operator_comment, body.note.trim()].filter(Boolean).join('\n')
    await service.from('orders').update({ operator_comment: merged }).eq('id', order.id)
    await logOrderEvent(service, order.id as string, 'operator_comment',
      { new: body.note.trim().slice(0, 300) }, actor)
  }

  await broadcastOrderChange(order.id as string, 'items')
  await notifyIntegrations(order.id as string, 'order.items_changed', service)

  const { data: updated } = await service.from('orders')
    .select(ORDER_FIELDS).eq('id', order.id).single()
  const [shaped] = await buildOrders(service, [updated])

  const response = {
    ok: true,
    applied: applied.length,
    unmatched,
    totals: { corrected: totals.corrected, ordered: totals.ordered, diff: totals.diff },
    weight_kg: weight.kg,
    order: shaped,
  }

  await remember(service, client.id, idemKey, response)
  await logRequest(service, client.id, req, 200, started)
  return NextResponse.json(response)
}

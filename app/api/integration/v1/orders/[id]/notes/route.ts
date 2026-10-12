import { NextRequest, NextResponse } from 'next/server'
import { authorize, isDenied, logRequest, replayed, remember } from '@/lib/integration-auth'
import { logOrderEvent } from '@/lib/order-events'
import { broadcastOrderChange } from '@/lib/order-broadcast'
import { notifyIntegrations } from '@/lib/integration-webhooks'

/**
 * POST /api/integration/v1/orders/{id}/notes
 *
 * Нотатка від зовнішньої системи — те, що склад або менеджер хоче сказати
 * оператору: «не було шпондера», «клієнт просив подзвонити перед виїздом».
 *
 * Дописується, а не замінює: коментар оператора — це розмова, а не поле.
 *
 *   { "text": "Замінили шпондер на грудинку", "author": "Комірник Олег" }
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

  const { text, author } = await req.json().catch(() => ({})) as
    { text?: string; author?: string }

  if (!text?.trim()) {
    await logRequest(service, client.id, req, 400, started, 'empty note')
    return NextResponse.json({ error: 'Порожня нотатка' }, { status: 400 })
  }

  const isUuid = /^[0-9a-f-]{36}$/i.test(id)
  const { data: order } = await service.from('orders')
    .select('id, operator_comment').eq(isUuid ? 'id' : 'external_id', id).maybeSingle()

  if (!order) {
    await logRequest(service, client.id, req, 404, started)
    return NextResponse.json({ error: 'Замовлення не знайдено' }, { status: 404 })
  }

  // Хто сказав — частина нотатки, а не лише журналу: оператор читає коментар,
  // а не історію змін
  const stamp = author?.trim() ? `${author.trim()}: ` : ''
  const merged = [order.operator_comment, `${stamp}${text.trim()}`]
    .filter(Boolean).join('\n')

  const { error } = await service.from('orders')
    .update({ operator_comment: merged, updated_at: new Date().toISOString() })
    .eq('id', order.id)

  if (error) {
    await logRequest(service, client.id, req, 500, started, error.message)
    return NextResponse.json({ error: 'Не вдалося зберегти' }, { status: 500 })
  }

  await logOrderEvent(service, order.id as string, 'operator_comment',
    { new: `${stamp}${text.trim()}`.slice(0, 300) },
    { id: client.id, name: `${client.name} (інтеграція)` })

  await broadcastOrderChange(order.id as string, 'operator_comment')
  await notifyIntegrations(order.id as string, 'order.note_added', service)

  const response = { ok: true, operator_comment: merged }
  await remember(service, client.id, idemKey, response)
  await logRequest(service, client.id, req, 200, started)
  return NextResponse.json(response)
}

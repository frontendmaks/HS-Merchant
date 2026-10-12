import { NextRequest, NextResponse } from 'next/server'
import { authorize, isDenied, logRequest } from '@/lib/integration-auth'
import { buildOrders, ORDER_FIELDS } from '@/lib/integration-order'

/**
 * GET /api/integration/v1/orders/{id}
 *
 * Одне замовлення. Приймає і наш UUID, і номер маркетплейсу (MD-…, RZ-…) —
 * зовнішня система частіше знає саме другий.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const started = Date.now()
  const auth = await authorize(req, 'orders:read')
  if (isDenied(auth)) return auth.response

  const { client, service } = auth
  const { id } = await params

  const isUuid = /^[0-9a-f-]{36}$/i.test(id)
  const { data } = await service.from('orders')
    .select(ORDER_FIELDS)
    .eq(isUuid ? 'id' : 'external_id', id)
    .maybeSingle()

  if (!data) {
    await logRequest(service, client.id, req, 404, started)
    return NextResponse.json({ error: 'Замовлення не знайдено' }, { status: 404 })
  }

  const [order] = await buildOrders(service, [data])
  await logRequest(service, client.id, req, 200, started)
  return NextResponse.json({ order })
}

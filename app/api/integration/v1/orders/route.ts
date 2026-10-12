import { NextRequest, NextResponse } from 'next/server'
import { authorize, isDenied, logRequest } from '@/lib/integration-auth'
import { buildOrders, ORDER_FIELDS } from '@/lib/integration-order'

/**
 * GET /api/integration/v1/orders
 *
 * Сторінка замовлень, упорядкована за часом останньої зміни.
 *
 * Курсор рахується від updated_at, а не від номера сторінки: поки клієнт
 * гортає, у Мерчанті тривають зміни, і нумерація сторінок поїхала б — частина
 * замовлень перестрибнула б через межу й не потрапила б у вибірку взагалі.
 *
 *   ?since=2026-10-12T08:00:00Z   усе, що змінилось після цієї мітки
 *   ?status=Узгоджено             лише цей статус
 *   ?platform=maudau              лише ця платформа
 *   ?limit=100                    до 200
 */
export async function GET(req: NextRequest) {
  const started = Date.now()
  const auth = await authorize(req, 'orders:read')
  if (isDenied(auth)) return auth.response

  const { client, service } = auth
  const params = req.nextUrl.searchParams
  const limit = Math.min(Math.max(Number(params.get('limit') ?? 50), 1), 200)

  let query = service.from('orders')
    .select(ORDER_FIELDS)
    .order('updated_at', { ascending: true })
    .limit(limit)

  const since = params.get('since')
  if (since) {
    const at = new Date(since)
    if (Number.isNaN(at.getTime())) {
      await logRequest(service, client.id, req, 400, started, 'bad since')
      return NextResponse.json(
        { error: 'Параметр since має бути датою у форматі ISO 8601' }, { status: 400 })
    }
    query = query.gt('updated_at', at.toISOString())
  }

  const status = params.get('status')
  if (status) query = query.eq('status', status)

  const platform = params.get('platform')
  if (platform) query = query.eq('platform', platform)

  const { data, error } = await query
  if (error) {
    await logRequest(service, client.id, req, 500, started, error.message)
    return NextResponse.json({ error: 'Не вдалося прочитати замовлення' }, { status: 500 })
  }

  const orders = await buildOrders(service, data ?? [])
  await logRequest(service, client.id, req, 200, started)

  return NextResponse.json({
    orders,
    // Звідки продовжувати наступного разу. Порожньо — більше нічого немає.
    next_since: orders.length === limit ? orders[orders.length - 1].updated_at : null,
    count: orders.length,
  })
}

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { notifyNewOrders } from '@/lib/customer-notify'
import { logCronRun } from '@/lib/cron-log'

export const maxDuration = 120

/**
 * Подяка за замовлення — тим, хто підписаний на наш канал.
 *
 * Ходить часто: лист «дякуємо за замовлення», що прийшов наступного дня,
 * не подяка, а нагадування про те, як довго ми мовчали.
 */
export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const service = createServiceClient()
  const limit = Math.min(Number(request.nextUrl.searchParams.get('limit') ?? 30), 100)

  const startedAt = Date.now()
  const result = await notifyNewOrders(service, { limit })
  await logCronRun(service, 'customer-notify', startedAt, result, result.error)

  return NextResponse.json(result)
}

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { notifyBySlot } from '@/lib/customer-notify'
import { logCronRun } from '@/lib/cron-log'

export const maxDuration = 120

/**
 * Сповіщення за періодом доставки.
 *
 * Ходить що чверть години: період починається о рівній годині, і
 * повідомлення «вирушило», яке прийшло через годину після того, як
 * кур'єр уже подзвонив, тільки дратує.
 */
export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const service = createServiceClient()
  const startedAt = Date.now()
  const result = await notifyBySlot(service)
  await logCronRun(service, 'delivery-notify', startedAt, result)

  return NextResponse.json(result)
}

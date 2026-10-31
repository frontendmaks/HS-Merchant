import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { refreshZones } from '@/lib/delivery-zones'
import { logCronRun } from '@/lib/cron-log'

/**
 * Щоденне оновлення карти доставки.
 *
 * Зони на сайті змінюють рідко, але мовчки. Якщо наша копія відстане, склад у
 * замовленні буде не той, і дізнаємось ми про це від комірника.
 */
export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const service = createServiceClient()
  const startedAt = Date.now()
  const result = await refreshZones(service)
  await logCronRun(service, 'zones', startedAt, result,
    (result as { error?: string }).error)
  return NextResponse.json(result)
}

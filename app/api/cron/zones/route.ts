import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { refreshZones } from '@/lib/delivery-zones'
import { refreshShopHours } from '@/lib/shop-hours'
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
  const zones = await refreshZones(service)
  /* Години складів міняють там само, де й карту, — беремо їх тим самим проходом */
  const hours = await refreshShopHours(service)
  const result = { ...zones, hours }
  await logCronRun(service, 'zones', startedAt, result,
    zones.error ?? hours.error)
  return NextResponse.json(result)
}

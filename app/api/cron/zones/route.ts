import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { refreshZones } from '@/lib/delivery-zones'

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
  return NextResponse.json(await refreshZones(createServiceClient()))
}

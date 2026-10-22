import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { refreshSundayZones } from '@/lib/sunday-zones'
import { logCronRun } from '@/lib/cron-log'

export const maxDuration = 60

/**
 * Недільна карта — раз на добу.
 *
 * Її правлять у Google My Maps, тобто там же, де й дивляться. Копія, яку
 * хтось мусив би оновлювати руками, розійшлася б із намальованим — і
 * дізнались би ми про це з маршруту, який поїхав не туди.
 */
export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const service = createServiceClient()
  const startedAt = Date.now()

  const result = await refreshSundayZones(service)
  await logCronRun(service, 'zones-sunday', startedAt, result, result.error)

  return NextResponse.json(result, { status: result.error ? 500 : 200 })
}

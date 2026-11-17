import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { pushPromPrices } from '@/lib/prom-run'
import { logCronRun } from '@/lib/cron-log'

export const maxDuration = 300

/**
 * Ціни й залишки на Prom.
 *
 * Фід Prom читає сам раз на чотири години — цього досить для опису й
 * фото, але не для залишку: за чотири години останню пачку встигають
 * продати двічі.
 */
export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const service = createServiceClient()
  const startedAt = Date.now()

  try {
    const result = await pushPromPrices(service)
    await logCronRun(service, 'prom-prices', startedAt, result)
    return NextResponse.json(result)
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    await logCronRun(service, 'prom-prices', startedAt, null, error)
    return NextResponse.json({ error }, { status: 500 })
  }
}

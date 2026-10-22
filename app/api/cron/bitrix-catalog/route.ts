import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { syncBitrixCatalog } from '@/lib/bitrix-catalog'
import { logCronRun } from '@/lib/cron-log'

export const maxDuration = 300

/**
 * Каталог Бітрікса — раз на добу.
 *
 * Товари там заводять не щогодини, а обхід коштує вісім десятків запитів.
 * Нічний час для цього найкращий: до ранкової зміни список свіжий.
 */
export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const service = createServiceClient()
  const startedAt = Date.now()

  try {
    const result = await syncBitrixCatalog(service)
    await logCronRun(service, 'bitrix-catalog', startedAt, result)
    return NextResponse.json(result)
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    await logCronRun(service, 'bitrix-catalog', startedAt, null, error)
    return NextResponse.json({ error }, { status: 500 })
  }
}

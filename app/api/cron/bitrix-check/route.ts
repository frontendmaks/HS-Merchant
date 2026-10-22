import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { checkDeals } from '@/lib/bitrix-missing'
import { sweepStaleHolds } from '@/lib/manual-register'
import { logCronRun } from '@/lib/cron-log'

export const maxDuration = 120

/**
 * Щогодини питаємо Бітрікс, чи всі наші угоди ще на місці.
 *
 * Частіше не треба: угоди не зникають щохвилини, а кожен прохід — це
 * десяток запитів до CRM. Рідше теж: розрив, помічений наступного дня,
 * це день, який склад збирав наосліп.
 */
export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const service = createServiceClient()
  const startedAt = Date.now()

  try {
    const result = await checkDeals(service)

    // Заразом повертаємо в обіг номери, що лишились за ніким
    const holds = await sweepStaleHolds(service)

    await logCronRun(service, 'bitrix-check', startedAt, { ...result, holds })
    return NextResponse.json({ ...result, holds })
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    await logCronRun(service, 'bitrix-check', startedAt, null, error)
    return NextResponse.json({ error }, { status: 500 })
  }
}

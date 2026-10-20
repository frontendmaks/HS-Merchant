import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { enrichNewCards } from '@/lib/trello-cards'
import { logCronRun } from '@/lib/cron-log'

export const maxDuration = 120

/**
 * Дописування карток у «Нових замовленнях».
 *
 * Ходить часто: картка з'являється через кілька хвилин після того, як
 * замовлення потрапило в Бітрікс, і номер ящика має стояти в ній до того,
 * як її візьме в роботу людина.
 */
export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const service = createServiceClient()
  const limit = Math.min(Number(request.nextUrl.searchParams.get('limit') ?? 40), 200)

  const startedAt = Date.now()
  const result = await enrichNewCards(service, { limit })
  await logCronRun(service, 'trello-cards', startedAt, result, result.error)

  return NextResponse.json(result)
}

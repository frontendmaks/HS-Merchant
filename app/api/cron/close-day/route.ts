import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { closeDay } from '@/lib/close-day'
import { logCronRun } from '@/lib/cron-log'

export const maxDuration = 300

/**
 * Закриття дня о 23:59 за Києвом.
 *
 * Розклад Vercel рахує в UTC, а київська північ припадає то на 21:00, то
 * на 22:00 — залежно від пори року. Тому прохід будиться двічі й сам
 * дивиться на місцевий годинник; зайвий виклик нічого не коштує, а
 * пропущена ніч лишила б учорашню чергу на ранок.
 */
export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const hour = Number(now.toLocaleString('en-GB', {
    timeZone: 'Europe/Kyiv', hour: '2-digit', hour12: false,
  }))

  const forced = request.nextUrl.searchParams.get('force') === '1'
  if (hour !== 23 && !forced) {
    return NextResponse.json({ waiting: `у Києві ${hour} година, чекаємо 23` })
  }

  /*
   * Серед дня закриваємо лише прострочене.
   *
   * `force` існує, щоб догнати пропущене, а не щоб скінчити день
   * достроково. Поки на годиннику не 23, сам цей день лишається в
   * роботі — хоч би хто й як покликав прохід.
   */
  const endOfDay = hour === 23

  const date = request.nextUrl.searchParams.get('date')
    ?? now.toLocaleDateString('en-CA', { timeZone: 'Europe/Kyiv' })

  const service = createServiceClient()
  const startedAt = Date.now()
  const result = await closeDay(service, { date, includeDay: endOfDay })
  await logCronRun(service, 'close-day', startedAt, { ...result, date })

  return NextResponse.json({ ...result, date })
}

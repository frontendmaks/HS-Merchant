export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { runPriceCheck } from '@/lib/price-run'

/**
 * 09:30 Kyiv, every day.
 *
 * Vercel schedules in UTC, and Kyiv is UTC+2 in winter and UTC+3 in summer, so
 * one fixed UTC time would drift an hour twice a year. The cron fires at both
 * 06:30 and 07:30 UTC and the run happens only on the firing that is 09:xx in
 * Kyiv — which is exactly one of them, whichever half of the year it is.
 */
function kyivHour(): number {
  return Number(new Intl.DateTimeFormat('uk-UA', {
    timeZone: 'Europe/Kyiv', hour: '2-digit', hour12: false,
  }).format(new Date()))
}

export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const hour = kyivHour()
  if (hour !== 9) {
    return NextResponse.json({ skipped: true, kyivHour: hour })
  }

  try {
    return NextResponse.json({ ok: true, ...(await runPriceCheck()) })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}

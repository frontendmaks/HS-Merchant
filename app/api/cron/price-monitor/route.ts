export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { runPriceCheck } from '@/lib/price-run'
import { buildReport, sendReport } from '@/lib/price-report'

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

  // Recorded the same way a manual pass is, so the page shows when the last
  // check happened whoever started it
  const service = createServiceClient()
  const { data: run } = await service.from('price_runs')
    .insert({ trigger: 'cron', current_step: 'Щоденна перевірка' })
    .select('id').single()
  const runId = run?.id as string | undefined

  try {
    const result = await runPriceCheck(service, runId)
    if (runId) {
      await service.from('price_runs').update({
        status: 'done', done: result.matched + result.missed,
        matched: result.matched, missed: result.missed,
        current_step: null, finished_at: new Date().toISOString(),
        error: result.errors.length ? result.errors.join('; ') : null,
      }).eq('id', runId)
    }
    // The report goes out after the pass, not with it: the counts have to be
    // of what was just collected, not of yesterday's rows
    const report = await buildReport(service)
    const notified = await sendReport(service, report)

    return NextResponse.json({ ok: true, ...result, report, notified })
  } catch (err) {
    if (runId) {
      await service.from('price_runs').update({
        status: 'failed', error: String(err), finished_at: new Date().toISOString(),
      }).eq('id', runId)
    }
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}

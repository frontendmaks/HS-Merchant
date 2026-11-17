import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { syncMaudau } from '@/lib/sync-maudau'
import { syncRozetka } from '@/lib/sync-rozetka'
import { syncProm } from '@/lib/sync-prom'
import { logCronRun } from '@/lib/cron-log'

// String(err) on an Error prefixes "Error: " — the platform name is already
// in front of it, so take the message alone.
const reasonText = (reason: unknown) =>
  reason instanceof Error ? reason.message : String(reason)

// ?mode=quick — only what changed in the last day, cheap enough to run every
// few minutes. ?mode=full (default) also re-reads the year.
export async function GET(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret') || req.headers.get('authorization')?.replace('Bearer ', '')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const mode = req.nextUrl.searchParams.get('mode') === 'quick' ? 'quick' : 'full'
  const start = Date.now()
  const supabase = createServiceClient()

  let maudauSynced = 0
  let rozetkasynced = 0
  let promSynced = 0
  let errorMsg: string | null = null

  try {
    /* allSettled, а не all: падіння одного майданчика не має залишати
       два інші без замовлень. Саме так МауДау з простроченим підписом
       тягнув би за собою Rozetka й Prom */
    const [maudau, rozetka, prom] = await Promise.allSettled([
      syncMaudau(mode),
      syncRozetka(mode),
      syncProm(mode),
    ])

    if (maudau.status === 'fulfilled') {
      maudauSynced = maudau.value.synced ?? 0
    } else {
      errorMsg = (errorMsg ? errorMsg + '; ' : '') + 'MauDau: ' + reasonText(maudau.reason)
    }

    if (rozetka.status === 'fulfilled') {
      rozetkasynced = rozetka.value.synced ?? 0
    } else {
      errorMsg = (errorMsg ? errorMsg + '; ' : '') + 'Rozetka: ' + reasonText(rozetka.reason)
    }

    if (prom.status === 'fulfilled') {
      promSynced = prom.value.synced ?? 0
    } else {
      errorMsg = (errorMsg ? errorMsg + '; ' : '') + 'Prom: ' + reasonText(prom.reason)
    }
  } catch (err) {
    errorMsg = String(err)
  }

  const duration = Date.now() - start

  await supabase.from('order_sync_logs').insert({
    // 'auto' keeps the every-few-minutes noise out of the cron history
    trigger: mode === 'quick' ? 'auto' : 'cron',
    status: errorMsg ? 'error' : 'success',
    maudau_synced: maudauSynced,
    rozetka_synced: rozetkasynced,
    error: errorMsg,
    duration_ms: duration,
  })

  /* Швидкий прохід має свій розклад і своє ім'я: інакше він ховав би
     в оглядi стан повного, і навпаки */
  await logCronRun(supabase, mode === 'quick' ? 'mp-sync-quick' : 'mp-sync', start,
    { mode, maudau: maudauSynced, rozetka: rozetkasynced, prom: promSynced },
    errorMsg ?? undefined)

  return NextResponse.json({
    success: !errorMsg,
    mode,
    maudau_synced: maudauSynced,
    rozetka_synced: rozetkasynced,
    prom_synced: promSynced,
    duration_ms: duration,
    error: errorMsg,
  })
}

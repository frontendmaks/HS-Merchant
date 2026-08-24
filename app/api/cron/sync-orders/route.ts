import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { syncMaudau } from '@/lib/sync-maudau'
import { syncRozetka } from '@/lib/sync-rozetka'

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
  let errorMsg: string | null = null

  try {
    const [maudau, rozetka] = await Promise.allSettled([
      syncMaudau(mode),
      syncRozetka(mode),
    ])

    if (maudau.status === 'fulfilled') {
      maudauSynced = maudau.value.synced ?? 0
    } else if (maudau.status === 'rejected') {
      errorMsg = (errorMsg ? errorMsg + '; ' : '') + 'MauDau: ' + String((maudau as PromiseRejectedResult).reason)
    }

    if (rozetka.status === 'fulfilled') {
      rozetkasynced = rozetka.value.synced ?? 0
    } else if (rozetka.status === 'rejected') {
      errorMsg = (errorMsg ? errorMsg + '; ' : '') + 'Rozetka: ' + String((rozetka as PromiseRejectedResult).reason)
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

  return NextResponse.json({
    success: !errorMsg,
    mode,
    maudau_synced: maudauSynced,
    rozetka_synced: rozetkasynced,
    duration_ms: duration,
    error: errorMsg,
  })
}

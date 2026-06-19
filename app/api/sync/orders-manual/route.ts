import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

async function getTriggeredBy(): Promise<string | null> {
  try {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
    )
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    const service = createServiceClient()
    const { data } = await service.from('profiles').select('full_name,email').eq('id', user.id).single()
    return data?.full_name || data?.email || user.email || null
  } catch { return null }
}

export async function POST(req: NextRequest) {
  const start = Date.now()
  const base = process.env.NEXT_PUBLIC_SITE_URL || `https://${req.headers.get('host')}`
  const supabase = createServiceClient()
  const triggeredBy = await getTriggeredBy()

  let maudauSynced = 0
  let rozetkasynced = 0
  let errorMsg: string | null = null

  try {
    const [maudau, rozetka] = await Promise.allSettled([
      fetch(`${base}/api/sync/maudau`, { method: 'POST' }).then(r => r.json()),
      fetch(`${base}/api/sync/rozetka`, { method: 'POST' }).then(r => r.json()),
    ])

    if (maudau.status === 'fulfilled' && maudau.value.success) {
      maudauSynced = maudau.value.synced ?? 0
    } else if (maudau.status === 'rejected') {
      errorMsg = (errorMsg ? errorMsg + '; ' : '') + 'MauDau: ' + String((maudau as PromiseRejectedResult).reason)
    } else if (maudau.status === 'fulfilled' && !maudau.value.success) {
      errorMsg = (errorMsg ? errorMsg + '; ' : '') + 'MauDau: ' + (maudau.value.error || 'unknown error')
    }

    if (rozetka.status === 'fulfilled' && rozetka.value.success) {
      rozetkasynced = rozetka.value.synced ?? 0
    } else if (rozetka.status === 'rejected') {
      errorMsg = (errorMsg ? errorMsg + '; ' : '') + 'Rozetka: ' + String((rozetka as PromiseRejectedResult).reason)
    } else if (rozetka.status === 'fulfilled' && !rozetka.value.success) {
      errorMsg = (errorMsg ? errorMsg + '; ' : '') + 'Rozetka: ' + (rozetka.value.error || 'unknown error')
    }
  } catch (err) {
    errorMsg = String(err)
  }

  const duration = Date.now() - start

  await supabase.from('order_sync_logs').insert({
    trigger: 'manual',
    triggered_by: triggeredBy,
    status: errorMsg ? 'error' : 'success',
    maudau_synced: maudauSynced,
    rozetka_synced: rozetkasynced,
    error: errorMsg,
    duration_ms: duration,
  })

  return NextResponse.json({
    success: !errorMsg,
    maudau_synced: maudauSynced,
    rozetka_synced: rozetkasynced,
    duration_ms: duration,
    error: errorMsg,
  })
}

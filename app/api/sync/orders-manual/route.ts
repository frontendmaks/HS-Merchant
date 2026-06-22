import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { syncMaudau } from '@/lib/sync-maudau'
import { syncRozetka } from '@/lib/sync-rozetka'

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
  const supabase = createServiceClient()
  const triggeredBy = await getTriggeredBy()

  // Optional: sync only one platform ('maudau' | 'rozetka') or both if not specified
  let platform: string | null = null
  try { const b = await req.json(); platform = b.platform ?? null } catch {}

  let maudauSynced = 0
  let rozetkasynced = 0
  let errorMsg: string | null = null

  try {
    if (!platform || platform === 'maudau') {
      try {
        const d = await syncMaudau()
        maudauSynced = d.synced ?? 0
      } catch (e) {
        errorMsg = (errorMsg ? errorMsg + '; ' : '') + 'MauDau: ' + String(e)
      }
    }

    if (!platform || platform === 'rozetka') {
      try {
        const d = await syncRozetka()
        rozetkasynced = d.synced ?? 0
      } catch (e) {
        errorMsg = (errorMsg ? errorMsg + '; ' : '') + 'Rozetka: ' + String(e)
      }
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

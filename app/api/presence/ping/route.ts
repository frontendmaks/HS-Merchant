import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Stamps the signed-in user as seen just now.
 *
 * Realtime presence only knows who is connected right this second, so it cannot
 * answer "when was this person last here" once the tab closes. The open tab
 * pings this every few minutes.
 */
export async function POST() {
  try {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
    )
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false }, { status: 401 })

    const service = createServiceClient()
    const now = new Date()

    // Truncated to the minute so repeated pings inside one minute collapse
    // onto a single row rather than inflating time online
    const minute = new Date(now)
    minute.setSeconds(0, 0)

    await Promise.all([
      service.from('profiles')
        .update({ last_seen_at: now.toISOString() })
        .eq('id', user.id),
      // The trail time-online is reconstructed from; last_seen_at alone cannot
      // answer how long anyone was here
      service.from('presence_ticks')
        .upsert({ user_id: user.id, minute: minute.toISOString() },
                { onConflict: 'user_id,minute', ignoreDuplicates: true }),
    ])

    return NextResponse.json({ ok: true })
  } catch {
    // A missed heartbeat is not worth surfacing
    return NextResponse.json({ ok: false })
  }
}

import { NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/service'
import { currentUserId } from '@/lib/session'
import { NEW_STATUSES, PROCESSING_STATUSES } from '@/lib/order-statuses'

// The identity is part of the cache key; personal request counts never leak.
const counts = unstable_cache(async (userId: string) => {
  const { data, error } = await createServiceClient().rpc('merchant_nav_counts', {
    p_user_id: userId, p_new: NEW_STATUSES, p_processing: PROCESSING_STATUSES,
  })
  if (error) throw error

  // Непрочитане в чатах — спільне для всіх, хто їх бачить, а не особисте
  const { data: threads } = await createServiceClient()
    .from('chat_threads').select('unread').gt('unread', 0)
  const unread = (threads ?? []).reduce((n, t) => n + Number(t.unread ?? 0), 0)

  return { ...(data as object), chats: { unread } }
}, ['nav-counts-v3'], { revalidate: 20 })

export async function GET() {
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await counts(userId), { headers: { 'Cache-Control': 'private, no-store' } })
}

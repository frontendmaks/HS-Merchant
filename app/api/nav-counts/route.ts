import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NEW_STATUSES, PROCESSING_STATUSES } from '@/lib/order-statuses'

async function getUserId(): Promise<string | null> {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll() {},
      },
    }
  )
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id ?? null
}

/** GET /api/nav-counts — badge figures for the sidebar's Запити and Замовлення. */
export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()
  // head: true returns the count alone — no rows travel back.
  const opts = { count: 'exact' as const, head: true }

  // Requests are personal: the badge counts what is on this user's own plate,
  // matching the requests page, where "mine" means being one of the assignees.
  // The inner join cannot double-count, since it is filtered to a single user.
  const assignedTo = (status: string) =>
    db
      .from('requests')
      .select('id, request_assignees!inner(user_id)', opts)
      .eq('status', status)
      .eq('request_assignees.user_id', userId)

  // Orders are a shared queue — everyone sees the same figures.
  const [reqNew, reqInProgress, ordNew, ordProcessing] = await Promise.all([
    assignedTo('new'),
    assignedTo('in_progress'),
    db.from('orders').select('id', opts).in('status', NEW_STATUSES),
    db.from('orders').select('id', opts).in('status', PROCESSING_STATUSES),
  ])

  return NextResponse.json({
    requests: { new: reqNew.count ?? 0, inProgress: reqInProgress.count ?? 0 },
    orders: { new: ordNew.count ?? 0, processing: ordProcessing.count ?? 0 },
  })
}

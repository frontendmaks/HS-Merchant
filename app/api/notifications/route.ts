import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

async function getUserId(): Promise<string | null> {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(list) {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        },
      },
    }
  )
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id ?? null
}

// GET /api/notifications — inbox for the signed-in user
export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient()
  const { data, error } = await service
    .from('notifications')
    .select('id, type, title, body, is_read, created_at, request_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const unread = (data ?? []).filter(n => !n.is_read).length
  return NextResponse.json({ notifications: data ?? [], unread })
}

// PATCH /api/notifications — mark one as read, or all of them
export async function PATCH(request: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, all } = await request.json() as { id?: string; all?: boolean }

  const service = createServiceClient()
  // Always scoped to the caller, so an id from someone else's inbox is a no-op
  let query = service.from('notifications').update({ is_read: true }).eq('user_id', userId)
  if (!all) {
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    query = query.eq('id', id)
  }

  const { error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

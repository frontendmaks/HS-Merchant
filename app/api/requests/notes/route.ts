import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { isAdmin, type UserRole } from '@/lib/getRole'
import { NOTIFICATION_TYPES } from '@/lib/requests'

async function getCaller() {
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
  if (!user) return null
  const service = createServiceClient()
  const { data } = await service.from('profiles').select('id, full_name, email, role').eq('id', user.id).single()
  return data
}

// POST /api/requests/notes — add a note and notify the other side
export async function POST(request: NextRequest) {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { request_id, body } = await request.json() as { request_id: string; body: string }
  if (!request_id || !body?.trim()) {
    return NextResponse.json({ error: 'Текст нотатки обовʼязковий' }, { status: 400 })
  }

  const service = createServiceClient()
  const { data: target } = await service
    .from('requests')
    .select('id, created_by, assigned_to, subject')
    .eq('id', request_id)
    .single()

  if (!target) return NextResponse.json({ error: 'Запит не знайдено' }, { status: 404 })

  const involved = target.created_by === caller.id || target.assigned_to === caller.id
  if (!involved && !isAdmin(caller.role as UserRole)) {
    return NextResponse.json({ error: 'Немає доступу до цього запиту' }, { status: 403 })
  }

  const { data: note, error } = await service.from('request_notes').insert({
    request_id,
    author_id: caller.id,
    body: body.trim(),
  }).select('id, body, created_at, author_id').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const name = caller.full_name?.trim() || caller.email
  // Both sides should hear about a note, except whoever wrote it
  const recipients = [target.created_by, target.assigned_to].filter(
    (uid, i, all) => uid !== caller.id && all.indexOf(uid) === i
  )

  if (recipients.length) {
    await service.from('notifications').insert(
      recipients.map(uid => ({
        user_id: uid,
        actor_id: caller.id,
        request_id,
        type: NOTIFICATION_TYPES.note,
        title: `${name} додав нотатку`,
        body: body.trim().slice(0, 160),
      }))
    )
  }

  return NextResponse.json({ success: true, note })
}

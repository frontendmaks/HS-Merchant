import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { isAdmin, type UserRole } from '@/lib/getRole'
import { NOTIFICATION_TYPES, normalizeRequest } from '@/lib/requests'

const SELECT = `
  id, category, subject, description, status, priority, deadline,
  created_at, updated_at, completed_at, created_by, assigned_to,
  author:profiles!requests_created_by_fkey(id, full_name, email),
  assignee:profiles!requests_assigned_to_fkey(id, full_name, email),
  notes:request_notes(id, body, created_at, author_id,
                      author:profiles!request_notes_author_id_fkey(full_name, email))
`

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

const displayName = (p: { full_name: string | null; email: string } | null | undefined) =>
  p?.full_name?.trim() || p?.email || 'Користувач'

// GET /api/requests — everything the caller is allowed to see
export async function GET() {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient()
  let query = service.from('requests').select(SELECT).order('created_at', { ascending: false })

  // Admins oversee the whole team; everyone else sees only their own threads
  if (!isAdmin(caller.role as UserRole)) {
    query = query.or(`created_by.eq.${caller.id},assigned_to.eq.${caller.id}`)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ requests: (data ?? []).map(normalizeRequest), me: caller })
}

// POST /api/requests — create a request and notify the assignee
export async function POST(request: NextRequest) {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as {
    assigned_to: string
    category: string
    subject: string
    description?: string
    priority?: string
    deadline?: string | null
  }

  if (!body.assigned_to || !body.category || !body.subject?.trim()) {
    return NextResponse.json({ error: 'Виконавець, категорія та запит обовʼязкові' }, { status: 400 })
  }

  const service = createServiceClient()
  const { data: created, error } = await service.from('requests').insert({
    created_by: caller.id,
    assigned_to: body.assigned_to,
    category: body.category,
    subject: body.subject.trim(),
    description: body.description?.trim() || null,
    priority: body.priority || 'normal',
    deadline: body.deadline || null,
  }).select('id, assigned_to, subject').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Don't ping yourself for a request you assigned to yourself
  if (created.assigned_to !== caller.id) {
    await service.from('notifications').insert({
      user_id: created.assigned_to,
      actor_id: caller.id,
      request_id: created.id,
      type: NOTIFICATION_TYPES.created,
      title: `Новий запит від ${displayName(caller)}`,
      body: created.subject,
    })
  }

  return NextResponse.json({ success: true, id: created.id })
}

// PATCH /api/requests — change status, deadline, priority or description
export async function PATCH(request: NextRequest) {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, status, deadline, priority, description } = await request.json() as {
    id: string
    status?: string
    deadline?: string | null
    priority?: string
    description?: string
  }
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const service = createServiceClient()
  const { data: before } = await service
    .from('requests')
    .select('id, created_by, assigned_to, subject, status, deadline, priority')
    .eq('id', id)
    .single()

  if (!before) return NextResponse.json({ error: 'Запит не знайдено' }, { status: 404 })

  const involved = before.created_by === caller.id || before.assigned_to === caller.id
  if (!involved && !isAdmin(caller.role as UserRole)) {
    return NextResponse.json({ error: 'Немає доступу до цього запиту' }, { status: 403 })
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (status !== undefined) {
    updates.status = status
    updates.completed_at = status === 'done' ? new Date().toISOString() : null
  }
  if (deadline !== undefined) updates.deadline = deadline || null
  if (priority !== undefined) updates.priority = priority
  if (description !== undefined) updates.description = description.trim() || null

  const { error } = await service.from('requests').update(updates).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Tell the other side what changed — never notify the person who did it
  const other = caller.id === before.created_by ? before.assigned_to : before.created_by
  const events: { type: string; title: string; body: string }[] = []

  if (status !== undefined && status !== before.status) {
    const wording: Record<string, string> = {
      done: 'виконав запит',
      in_progress: 'взяв запит у роботу',
      canceled: 'скасував запит',
      new: 'повернув запит у новий',
    }
    events.push({
      type: NOTIFICATION_TYPES.status,
      title: `${displayName(caller)} ${wording[status] ?? 'змінив статус запиту'}`,
      body: before.subject,
    })
  }
  if (deadline !== undefined && (deadline || null) !== before.deadline) {
    const human = deadline
      ? new Date(deadline + 'T00:00:00').toLocaleDateString('uk-UA')
      : 'без дедлайну'
    events.push({
      type: NOTIFICATION_TYPES.deadline,
      title: `${displayName(caller)} змінив дедлайн на ${human}`,
      body: before.subject,
    })
  }
  if (priority !== undefined && priority !== before.priority) {
    events.push({
      type: NOTIFICATION_TYPES.updated,
      title: `${displayName(caller)} змінив пріоритет запиту`,
      body: before.subject,
    })
  }

  if (events.length && other !== caller.id) {
    await service.from('notifications').insert(
      events.map(e => ({ ...e, user_id: other, actor_id: caller.id, request_id: id }))
    )
  }

  return NextResponse.json({ success: true })
}

// DELETE /api/requests — only the person who raised the request may remove it
export async function DELETE(request: NextRequest) {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await request.json() as { id: string }
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const service = createServiceClient()
  const { data: target } = await service.from('requests').select('created_by').eq('id', id).single()
  if (!target) return NextResponse.json({ error: 'Запит не знайдено' }, { status: 404 })

  if (target.created_by !== caller.id) {
    return NextResponse.json({ error: 'Видалити запит може лише той, хто його створив' }, { status: 403 })
  }

  const { error } = await service.from('requests').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

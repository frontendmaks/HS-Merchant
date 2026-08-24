import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { isAdmin, type UserRole } from '@/lib/getRole'
import {
  NOTIFICATION_TYPES, normalizeRequest, PRIORITY_META,
  type RequestStatus, type RequestPriority,
} from '@/lib/requests'

const SELECT = `
  id, category, subject, description, status, priority, deadline,
  created_at, updated_at, completed_at, created_by,
  author:profiles!requests_created_by_fkey(id, full_name, email),
  assignees:request_assignees(user:profiles!request_assignees_user_id_fkey(id, full_name, email)),
  notes:request_notes(id, body, created_at, author_id,
                      author:profiles!request_notes_author_id_fkey(full_name, email)),
  events:request_events(id, type, old_value, new_value, created_at,
                        actor:profiles!request_events_actor_id_fkey(full_name, email))
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

type Service = ReturnType<typeof createServiceClient>

async function assigneeIds(service: Service, requestId: string): Promise<string[]> {
  const { data } = await service.from('request_assignees').select('user_id').eq('request_id', requestId)
  return (data ?? []).map(r => r.user_id)
}

/** Append to the request's journal. */
async function logEvent(
  service: Service, requestId: string, actorId: string,
  type: string, oldValue?: string | null, newValue?: string | null,
) {
  await service.from('request_events').insert({
    request_id: requestId, actor_id: actorId, type,
    old_value: oldValue ?? null, new_value: newValue ?? null,
  })
}

async function notify(
  service: Service, userIds: string[], actorId: string, requestId: string,
  type: string, title: string, body: string,
) {
  const targets = [...new Set(userIds)].filter(id => id && id !== actorId)
  if (!targets.length) return
  await service.from('notifications').insert(
    targets.map(user_id => ({ user_id, actor_id: actorId, request_id: requestId, type, title, body }))
  )
}

// GET /api/requests — everything the caller is allowed to see
export async function GET() {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient()

  let ids: string[] | null = null
  if (!isAdmin(caller.role as UserRole)) {
    // Own threads: raised by me, or addressed to me
    const [{ data: mine }, { data: authored }] = await Promise.all([
      service.from('request_assignees').select('request_id').eq('user_id', caller.id),
      service.from('requests').select('id').eq('created_by', caller.id),
    ])
    ids = [...new Set([
      ...(mine ?? []).map(r => r.request_id),
      ...(authored ?? []).map(r => r.id),
    ])]
    if (ids.length === 0) return NextResponse.json({ requests: [], me: caller })
  }

  let query = service.from('requests').select(SELECT).order('created_at', { ascending: false })
  if (ids) query = query.in('id', ids)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ requests: (data ?? []).map(normalizeRequest), me: caller })
}

// POST /api/requests — create a request and notify every assignee
export async function POST(request: NextRequest) {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as {
    assignees: string[]
    category: string
    subject: string
    description?: string
    priority?: string
    deadline?: string | null
  }

  const targets = [...new Set(body.assignees ?? [])].filter(Boolean)
  if (!targets.length || !body.category || !body.subject?.trim()) {
    return NextResponse.json({ error: 'Виконавець, категорія та запит обовʼязкові' }, { status: 400 })
  }

  const service = createServiceClient()
  const { data: created, error } = await service.from('requests').insert({
    created_by: caller.id,
    category: body.category,
    subject: body.subject.trim(),
    description: body.description?.trim() || null,
    priority: body.priority || 'normal',
    deadline: body.deadline || null,
  }).select('id, subject').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { error: linkError } = await service.from('request_assignees')
    .insert(targets.map(user_id => ({ request_id: created.id, user_id })))
  if (linkError) {
    // Never leave a request with nobody responsible for it
    await service.from('requests').delete().eq('id', created.id)
    return NextResponse.json({ error: linkError.message }, { status: 500 })
  }

  await logEvent(service, created.id, caller.id, 'created', null, created.subject)
  await notify(service, targets, caller.id, created.id, NOTIFICATION_TYPES.created,
    `Новий запит від ${displayName(caller)}`, created.subject)

  return NextResponse.json({ success: true, id: created.id })
}

// PATCH /api/requests — status, deadline, priority, description or assignees
export async function PATCH(request: NextRequest) {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, status, deadline, priority, description, assignees } = await request.json() as {
    id: string
    status?: RequestStatus
    deadline?: string | null
    priority?: RequestPriority
    description?: string
    assignees?: string[]
  }
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const service = createServiceClient()
  const { data: before } = await service
    .from('requests')
    .select('id, created_by, subject, status, deadline, priority, description')
    .eq('id', id)
    .single()

  if (!before) return NextResponse.json({ error: 'Запит не знайдено' }, { status: 404 })

  const currentAssignees = await assigneeIds(service, id)
  const isAuthor = before.created_by === caller.id
  const isAssignee = currentAssignees.includes(caller.id)
  const admin = isAdmin(caller.role as UserRole)

  if (!isAuthor && !isAssignee && !admin) {
    return NextResponse.json({ error: 'Немає доступу до цього запиту' }, { status: 403 })
  }

  // Only the person who raised the request re-prioritises or re-assigns it
  if (priority !== undefined && priority !== before.priority && !isAuthor) {
    return NextResponse.json(
      { error: 'Пріоритет може змінювати лише той, хто поставив запит' }, { status: 403 })
  }
  if (assignees !== undefined && !isAuthor) {
    return NextResponse.json(
      { error: 'Виконавців може змінювати лише той, хто поставив запит' }, { status: 403 })
  }
  // Sign-off belongs to the author: an assignee sends work for review, never closes it
  if (status === 'done' && !isAuthor) {
    return NextResponse.json(
      { error: 'Закрити запит може лише той, хто його поставив' }, { status: 403 })
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

  // Reassignment replaces the whole set
  if (assignees !== undefined) {
    const next = [...new Set(assignees)].filter(Boolean)
    if (!next.length) {
      return NextResponse.json({ error: 'Потрібен хоча б один виконавець' }, { status: 400 })
    }
    await service.from('request_assignees').delete().eq('request_id', id)
    await service.from('request_assignees').insert(next.map(user_id => ({ request_id: id, user_id })))
    await logEvent(service, id, caller.id, 'assignees',
      String(currentAssignees.length), String(next.length))
    await notify(service, next, caller.id, id, NOTIFICATION_TYPES.updated,
      `${displayName(caller)} призначив вам запит`, before.subject)
  }

  const audience = [...currentAssignees, before.created_by]

  if (status !== undefined && status !== before.status) {
    const eventType =
      status === 'done' && before.status === 'pending_review' ? 'confirmed'
      : status === 'rework' ? 'returned'
      : 'status'
    await logEvent(service, id, caller.id, eventType, before.status, status)

    const wording: Record<string, string> = {
      in_progress:    'взяв запит у роботу',
      pending_review: 'виконав запит — потрібне підтвердження',
      rework:         'повернув запит на доопрацювання',
      done:           'підтвердив виконання запиту',
      canceled:       'скасував запит',
      new:            'повернув запит у новий',
    }
    await notify(
      service, audience, caller.id, id,
      status === 'pending_review' ? NOTIFICATION_TYPES.review : NOTIFICATION_TYPES.status,
      `${displayName(caller)} ${wording[status] ?? 'змінив статус запиту'}`,
      before.subject,
    )
  }

  if (deadline !== undefined && (deadline || null) !== before.deadline) {
    await logEvent(service, id, caller.id, 'deadline', before.deadline, deadline || null)
    const human = deadline
      ? new Date(deadline + 'T00:00:00').toLocaleDateString('uk-UA')
      : 'без дедлайну'
    await notify(service, audience, caller.id, id, NOTIFICATION_TYPES.deadline,
      `${displayName(caller)} змінив дедлайн на ${human}`, before.subject)
  }

  if (priority !== undefined && priority !== before.priority) {
    await logEvent(service, id, caller.id, 'priority', before.priority, priority)
    await notify(service, audience, caller.id, id, NOTIFICATION_TYPES.updated,
      `${displayName(caller)} змінив пріоритет на «${PRIORITY_META[priority]?.label ?? priority}»`,
      before.subject)
  }

  if (description !== undefined && (description.trim() || null) !== before.description) {
    await logEvent(service, id, caller.id, 'description', before.description, description.trim() || null)
    await notify(service, audience, caller.id, id, NOTIFICATION_TYPES.updated,
      `${displayName(caller)} змінив опис запиту`, before.subject)
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

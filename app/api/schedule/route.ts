/**
 * The operators' weekly schedule.
 *
 *   GET  ?week=YYYY-MM-DD   the week's grid, swaps, journal and the team
 *   PUT  { week, shifts }   replace the marked days, for whoever holds the pen
 *   POST { week, action }   move it along: submit, approve, amend, send_back, agree
 *
 * The week is agreed by passing it between the two sides rather than by one of
 * them deciding, so the status names who holds the pen and every handover is
 * written to the journal.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor } from '@/lib/order-events'
import { getCurrentRole } from '@/lib/getRole'
import {
  actionsFor, canApprove, canParticipate, holdsPen, isPlannable, weekLabel, weekStartOf,
  thisWeekStart, type ScheduleAction, type ScheduleStatus,
} from '@/lib/schedule'
import { approvers, notify, operators } from '@/lib/schedule-notify'

type Service = ReturnType<typeof createServiceClient>

const validWeek = (s: string | null): string | null =>
  s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? weekStartOf(s) : null

/** The row for a week, created on first sight so the grid always has one. */
async function weekRow(supabase: Service, week: string) {
  const { data } = await supabase
    .from('work_schedules').select('*').eq('week_start', week).maybeSingle()
  if (data) return data
  const { data: made } = await supabase
    .from('work_schedules').insert({ week_start: week }).select('*').single()
  return made
}

async function logEvent(
  supabase: Service,
  scheduleId: string,
  actorId: string,
  type: string,
  details?: unknown,
): Promise<void> {
  try {
    await supabase.from('schedule_events').insert({
      schedule_id: scheduleId, actor_id: actorId, type, details: details ?? null,
    })
  } catch {
    // The journal must never be the reason an action fails
  }
}

export async function GET(req: NextRequest) {
  const actor = await currentActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const week = validWeek(req.nextUrl.searchParams.get('week')) ?? thisWeekStart()
  const supabase = createServiceClient()
  const schedule = await weekRow(supabase, week)
  if (!schedule) return NextResponse.json({ error: 'Не вдалося відкрити тиждень' }, { status: 500 })

  const [{ data: shifts }, { data: swaps }, { data: team }, { data: events }] = await Promise.all([
    supabase.from('work_shifts').select('operator_id, work_date').eq('schedule_id', schedule.id),
    supabase.from('shift_swaps').select('*').eq('schedule_id', schedule.id)
      .order('created_at', { ascending: false }),
    supabase.from('profiles').select('id, full_name, email')
      .eq('role', 'operator').eq('is_active', true).order('full_name'),
    supabase.from('schedule_events')
      .select('id, type, details, created_at, actor:profiles!schedule_events_actor_id_fkey(full_name, email)')
      .eq('schedule_id', schedule.id).order('created_at', { ascending: false }).limit(100),
  ])

  return NextResponse.json({
    schedule,
    shifts: shifts ?? [],
    swaps: swaps ?? [],
    operators: team ?? [],
    events: events ?? [],
  })
}

export async function PUT(req: NextRequest) {
  const actor = await currentActor()
  const role = await getCurrentRole()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canParticipate(role)) return NextResponse.json({ error: 'Немає прав' }, { status: 403 })

  const { week: rawWeek, shifts } = await req.json() as {
    week: string
    shifts: { operator_id: string; work_date: string }[]
  }
  const week = validWeek(rawWeek)
  if (!week) return NextResponse.json({ error: 'Некоректний тиждень' }, { status: 400 })

  // Planning reaches one week ahead; anything else is a record, not a plan
  if (!isPlannable(week)) {
    return NextResponse.json(
      { error: 'Планувати можна лише поточний і наступний тиждень' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const schedule = await weekRow(supabase, week)
  if (!schedule) return NextResponse.json({ error: 'Тиждень не знайдено' }, { status: 500 })

  if (!holdsPen(schedule.status as ScheduleStatus, role)) {
    return NextResponse.json({ error: 'Зараз графік редагує інша сторона' }, { status: 403 })
  }

  const { data: before } = await supabase
    .from('work_shifts').select('operator_id, work_date').eq('schedule_id', schedule.id)

  const key = (r: { operator_id: string; work_date: string }) => `${r.operator_id}|${r.work_date}`
  const had = new Set((before ?? []).map(key))
  const now = new Set((shifts ?? []).map(key))
  const added = [...now].filter(k => !had.has(k))
  const removed = [...had].filter(k => !now.has(k))

  if (!added.length && !removed.length) return NextResponse.json({ ok: true, unchanged: true })

  await supabase.from('work_shifts').delete().eq('schedule_id', schedule.id)
  if (shifts?.length) {
    const { error } = await supabase.from('work_shifts').insert(
      shifts.map(s => ({ schedule_id: schedule.id, operator_id: s.operator_id, work_date: s.work_date })),
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await supabase.from('work_schedules')
    .update({ updated_at: new Date().toISOString() }).eq('id', schedule.id)

  // What changed, not merely that something did
  await logEvent(supabase, schedule.id, actor.id, 'edited', { added, removed })

  return NextResponse.json({ ok: true, added: added.length, removed: removed.length })
}

/** Where an action leaves the week. 'amend' depends on who reached for it:
 *  management takes the pen, an operator takes it back to their own draft. */
function nextStatus(action: ScheduleAction, management: boolean): ScheduleStatus {
  switch (action) {
    case 'submit': return 'review_manager'
    case 'amend': return management ? 'editing_manager' : 'draft'
    case 'send_back': return 'review_operators'
    case 'approve': return 'approved'
    case 'agree': return 'approved'
  }
}

export async function POST(req: NextRequest) {
  const actor = await currentActor()
  const role = await getCurrentRole()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canParticipate(role)) return NextResponse.json({ error: 'Немає прав' }, { status: 403 })

  const { week: rawWeek, action } = await req.json() as { week: string; action: ScheduleAction }
  const week = validWeek(rawWeek)
  if (!week) return NextResponse.json({ error: 'Некоректний тиждень' }, { status: 400 })
  if (!isPlannable(week)) {
    return NextResponse.json({ error: 'Цей тиждень уже не змінюється' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const schedule = await weekRow(supabase, week)
  if (!schedule) return NextResponse.json({ error: 'Тиждень не знайдено' }, { status: 500 })

  const status = schedule.status as ScheduleStatus
  // The same table the buttons are drawn from, so the server can never be
  // talked into a move the interface would not offer
  if (!actionsFor(status, role, true).includes(action)) {
    return NextResponse.json({ error: 'Ця дія зараз недоступна' }, { status: 403 })
  }

  if (action === 'submit') {
    const { count } = await supabase
      .from('work_shifts').select('*', { count: 'exact', head: true }).eq('schedule_id', schedule.id)
    if (!count) {
      return NextResponse.json({ error: 'Графік порожній — позначте робочі дні' }, { status: 400 })
    }
  }

  const now = new Date().toISOString()
  const management = canApprove(role)
  const next = nextStatus(action, management)
  const patch: Record<string, unknown> = { status: next, updated_at: now }

  if (action === 'submit') { patch.submitted_by = actor.id; patch.submitted_at = now }
  if (next === 'approved') { patch.approved_by = actor.id; patch.approved_at = now }
  // Back in play — an old approval stamp would misread as still current
  if (action === 'amend') { patch.approved_by = null; patch.approved_at = null }

  const { error } = await supabase.from('work_schedules').update(patch).eq('id', schedule.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const EVENT: Record<ScheduleAction, string> = {
    submit: 'submitted', approve: 'approved', amend: 'amend',
    send_back: 'sent_back', agree: 'agreed',
  }
  await logEvent(supabase, schedule.id, actor.id, EVENT[action])

  const label = weekLabel(week)
  const tell = async (who: 'operators' | 'approvers', title: string, body: string, type: string) => {
    const ids = who === 'operators' ? await operators(supabase) : await approvers(supabase)
    await notify(supabase, ids.filter(id => id !== actor.id), {
      type, title, body, actorId: actor.id, link: `/operators/schedule?week=${week}`,
    })
  }

  if (action === 'submit') {
    await tell('approvers', 'Графік на затвердження', `${actor.name} надіслав графік на ${label}`, 'schedule_submitted')
  } else if (action === 'amend') {
    // Whoever is now waiting is the side that should hear about it
    await tell(management ? 'operators' : 'approvers', 'Графік на правках',
      `${actor.name} вносить зміни в графік на ${label}`, 'schedule_amend')
  } else if (action === 'send_back') {
    await tell('operators', 'Графік на розгляд', `${actor.name} змінив графік на ${label} — перегляньте`, 'schedule_sent_back')
  } else {
    await tell('operators', 'Графік затверджено', `${actor.name} затвердив графік на ${label}`, 'schedule_approved')
    if (management) return NextResponse.json({ ok: true, status: next })
    await tell('approvers', 'Графік погоджено', `${actor.name} погодив графік на ${label}`, 'schedule_approved')
  }

  return NextResponse.json({ ok: true, status: next })
}

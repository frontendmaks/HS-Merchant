/**
 * The operators' weekly schedule.
 *
 *   GET  ?week=YYYY-MM-DD   the week's grid, its swaps, and who is on the team
 *   PUT  { week, shifts }   replace the week's marked days (operators, while open)
 *   POST { week, action }   'submit' hands it to management, 'approve' accepts it
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor } from '@/lib/order-events'
import { getCurrentRole } from '@/lib/getRole'
import {
  canApprove, isPastWeek, thisWeekStart, weekLabel, weekStartOf,
  type ScheduleStatus,
} from '@/lib/schedule'
import { approvers, notify, operators } from '@/lib/schedule-notify'

const validWeek = (s: string | null): string | null =>
  s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? weekStartOf(s) : null

/** The row for a week, created on first sight so the grid always has one. */
async function weekRow(week: string) {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('work_schedules').select('*').eq('week_start', week).maybeSingle()
  if (data) return data

  const { data: made } = await supabase
    .from('work_schedules').insert({ week_start: week }).select('*').single()
  return made
}

export async function GET(req: NextRequest) {
  const actor = await currentActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const week = validWeek(req.nextUrl.searchParams.get('week')) ?? thisWeekStart()
  const supabase = createServiceClient()
  const schedule = await weekRow(week)
  if (!schedule) return NextResponse.json({ error: 'Не вдалося відкрити тиждень' }, { status: 500 })

  const [{ data: shifts }, { data: swaps }, { data: team }] = await Promise.all([
    supabase.from('work_shifts').select('operator_id, work_date').eq('schedule_id', schedule.id),
    supabase.from('shift_swaps').select('*').eq('schedule_id', schedule.id)
      .order('created_at', { ascending: false }),
    supabase.from('profiles').select('id, full_name, email')
      .eq('role', 'operator').eq('is_active', true).order('full_name'),
  ])

  return NextResponse.json({
    schedule,
    shifts: shifts ?? [],
    swaps: swaps ?? [],
    operators: team ?? [],
  })
}

export async function PUT(req: NextRequest) {
  const actor = await currentActor()
  const role = await getCurrentRole()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { week: rawWeek, shifts } = await req.json() as {
    week: string
    shifts: { operator_id: string; work_date: string }[]
  }
  const week = validWeek(rawWeek)
  if (!week) return NextResponse.json({ error: 'Некоректний тиждень' }, { status: 400 })

  // A past week is the record of what happened, not a plan to revise
  if (isPastWeek(week)) {
    return NextResponse.json({ error: 'Минулий тиждень не редагується' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const schedule = await weekRow(week)
  if (!schedule) return NextResponse.json({ error: 'Тиждень не знайдено' }, { status: 500 })

  // Once management has approved it, only they may reopen it
  if (schedule.status === 'approved' && !canApprove(role)) {
    return NextResponse.json({ error: 'Графік затверджено — зміни через заміну' }, { status: 403 })
  }

  const days = new Set((await supabase.from('work_shifts').select('id').eq('schedule_id', schedule.id)).data?.map(r => r.id))
  if (days.size) await supabase.from('work_shifts').delete().eq('schedule_id', schedule.id)

  if (shifts?.length) {
    const { error } = await supabase.from('work_shifts').insert(
      shifts.map(s => ({ schedule_id: schedule.id, operator_id: s.operator_id, work_date: s.work_date })),
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await supabase.from('work_schedules')
    .update({ updated_at: new Date().toISOString() }).eq('id', schedule.id)

  return NextResponse.json({ ok: true })
}

export async function POST(req: NextRequest) {
  const actor = await currentActor()
  const role = await getCurrentRole()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { week: rawWeek, action } = await req.json() as {
    week: string
    action: 'submit' | 'approve' | 'reopen'
  }
  const week = validWeek(rawWeek)
  if (!week) return NextResponse.json({ error: 'Некоректний тиждень' }, { status: 400 })

  const supabase = createServiceClient()
  const schedule = await weekRow(week)
  if (!schedule) return NextResponse.json({ error: 'Тиждень не знайдено' }, { status: 500 })

  const now = new Date().toISOString()
  let status: ScheduleStatus
  const patch: Record<string, unknown> = { updated_at: now }

  if (action === 'submit') {
    const { count } = await supabase
      .from('work_shifts').select('*', { count: 'exact', head: true }).eq('schedule_id', schedule.id)
    if (!count) {
      return NextResponse.json({ error: 'Графік порожній — позначте робочі дні' }, { status: 400 })
    }
    status = 'submitted'
    patch.submitted_by = actor.id
    patch.submitted_at = now

    await notify(supabase, await approvers(supabase), {
      type: 'schedule_submitted',
      title: 'Графік на підтвердження',
      body: `${actor.name} надіслав графік на ${weekLabel(week)}`,
      actorId: actor.id,
    })
  } else if (action === 'approve') {
    if (!canApprove(role)) return NextResponse.json({ error: 'Немає прав' }, { status: 403 })
    status = 'approved'
    patch.approved_by = actor.id
    patch.approved_at = now

    await notify(supabase, await operators(supabase), {
      type: 'schedule_approved',
      title: 'Графік затверджено',
      body: `${actor.name} затвердив графік на ${weekLabel(week)}`,
      actorId: actor.id,
    })
  } else if (action === 'reopen') {
    if (!canApprove(role)) return NextResponse.json({ error: 'Немає прав' }, { status: 403 })
    status = 'draft'
    patch.approved_by = null
    patch.approved_at = null
    patch.submitted_at = null

    await notify(supabase, await operators(supabase), {
      type: 'schedule_reopened',
      title: 'Графік повернуто на доопрацювання',
      body: `${actor.name} відкрив графік на ${weekLabel(week)}`,
      actorId: actor.id,
    })
  } else {
    return NextResponse.json({ error: 'Невідома дія' }, { status: 400 })
  }

  patch.status = status
  const { error } = await supabase.from('work_schedules').update(patch).eq('id', schedule.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, status })
}

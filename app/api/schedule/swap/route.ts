/**
 * Handing a day from one operator to another.
 *
 *   POST  { week, work_date, to_operator, reason }   ask for the swap
 *   PATCH { id, decision }                           'approve' | 'decline'
 *
 * A swap moves the day only once both the operator taking it and a manager
 * have agreed. Either alone leaves it pending, so no one can move someone
 * else's day by themselves. Where the shop has no manager or admin at all, the
 * other operator's agreement is the whole of it.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor } from '@/lib/order-events'
import { getCurrentRole } from '@/lib/getRole'
import { canApprove, dayLabel, isPastWeek, weekStartOf } from '@/lib/schedule'
import { approvers, notify } from '@/lib/schedule-notify'

type Service = ReturnType<typeof createServiceClient>

const nameOf = async (supabase: Service, id: string): Promise<string> => {
  const { data } = await supabase.from('profiles').select('full_name, email').eq('id', id).maybeSingle()
  return (data?.full_name as string) || (data?.email as string) || 'оператор'
}

export async function POST(req: NextRequest) {
  const actor = await currentActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { work_date, to_operator, reason } = await req.json() as {
    work_date: string; to_operator: string; reason?: string
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(work_date ?? '') || !to_operator) {
    return NextResponse.json({ error: 'Вкажіть день і кому передаєте' }, { status: 400 })
  }
  if (to_operator === actor.id) {
    return NextResponse.json({ error: 'Не можна передати зміну самому собі' }, { status: 400 })
  }

  const week = weekStartOf(work_date)
  if (isPastWeek(week)) {
    return NextResponse.json({ error: 'Минулий тиждень не змінюється' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data: schedule } = await supabase
    .from('work_schedules').select('id').eq('week_start', week).maybeSingle()
  if (!schedule) return NextResponse.json({ error: 'Графік на цей тиждень ще не створено' }, { status: 400 })

  // The day has to actually be the asker's to give away
  const { data: mine } = await supabase.from('work_shifts')
    .select('id').eq('schedule_id', schedule.id)
    .eq('operator_id', actor.id).eq('work_date', work_date).maybeSingle()
  if (!mine) return NextResponse.json({ error: 'Цей день не ваш' }, { status: 400 })

  // Handing a day to someone already working it would collide with the one
  // row per operator per day, and would mean nothing anyway
  const { data: theirs } = await supabase.from('work_shifts')
    .select('id').eq('schedule_id', schedule.id)
    .eq('operator_id', to_operator).eq('work_date', work_date).maybeSingle()
  if (theirs) {
    return NextResponse.json(
      { error: 'Цей оператор уже працює в цей день' }, { status: 400 })
  }

  // Two people cannot be negotiating the same day at once
  const { data: open } = await supabase.from('shift_swaps')
    .select('id').eq('schedule_id', schedule.id)
    .eq('work_date', work_date).eq('status', 'pending').maybeSingle()
  if (open) return NextResponse.json({ error: 'По цьому дню вже є запит на заміну' }, { status: 400 })

  const { data: swap, error } = await supabase.from('shift_swaps').insert({
    schedule_id: schedule.id,
    work_date,
    from_operator: actor.id,
    to_operator,
    reason: reason?.trim() || null,
    created_by: actor.id,
  }).select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const body = `${actor.name} просить передати вам зміну ${dayLabel(work_date)}` +
    (reason?.trim() ? ` — ${reason.trim()}` : '')
  await notify(supabase, [to_operator], {
    type: 'swap_request', title: 'Запит на заміну', body, actorId: actor.id,
  })
  await notify(supabase, await approvers(supabase), {
    type: 'swap_request',
    title: 'Заміна в графіку',
    body: `${actor.name} → ${await nameOf(supabase, to_operator)} · ${dayLabel(work_date)}`,
    actorId: actor.id,
  })

  return NextResponse.json({ ok: true, id: swap.id })
}

export async function PATCH(req: NextRequest) {
  const actor = await currentActor()
  const role = await getCurrentRole()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, decision } = await req.json() as { id: string; decision: 'approve' | 'decline' }
  const supabase = createServiceClient()

  const { data: swap } = await supabase.from('shift_swaps').select('*').eq('id', id).maybeSingle()
  if (!swap) return NextResponse.json({ error: 'Запит не знайдено' }, { status: 404 })
  if (swap.status !== 'pending') {
    return NextResponse.json({ error: 'Запит уже опрацьовано' }, { status: 400 })
  }

  const isPeer = actor.id === swap.to_operator
  const isManager = canApprove(role)
  if (!isPeer && !isManager) return NextResponse.json({ error: 'Немає прав' }, { status: 403 })

  const now = new Date().toISOString()

  if (decision === 'decline') {
    await supabase.from('shift_swaps').update({
      status: 'declined', resolved_by: actor.id, resolved_at: now,
    }).eq('id', id)

    await notify(supabase, [swap.from_operator, swap.to_operator, ...(await approvers(supabase))], {
      type: 'swap_declined',
      title: 'Заміну відхилено',
      body: `${actor.name} відхилив заміну ${dayLabel(swap.work_date)}`,
      actorId: actor.id,
    })
    return NextResponse.json({ ok: true, status: 'declined' })
  }

  const patch: Record<string, unknown> = {}
  // A manager who is also the receiving operator answers for both halves
  if (isPeer) { patch.peer_ok_by = actor.id; patch.peer_ok_at = now }
  if (isManager) { patch.manager_ok_by = actor.id; patch.manager_ok_at = now }

  const peerOk = !!(swap.peer_ok_at || patch.peer_ok_at)
  const managerOk = !!(swap.manager_ok_at || patch.manager_ok_at)
  // With nobody in a managing role, the other operator's word is the whole of it
  const managerExists = (await approvers(supabase)).length > 0
  const settled = peerOk && (managerOk || !managerExists)

  if (!settled) {
    await supabase.from('shift_swaps').update(patch).eq('id', id)
    const waitingFor = peerOk ? 'керівника' : 'другого оператора'
    return NextResponse.json({ ok: true, status: 'pending', waitingFor })
  }

  // Both halves in — move the day. The receiver may have picked it up in the
  // meantime, which the one-row-per-day rule would refuse; say so rather than
  // marking the swap done on a move that never happened.
  const { error: moveError } = await supabase.from('work_shifts')
    .update({ operator_id: swap.to_operator })
    .eq('schedule_id', swap.schedule_id)
    .eq('operator_id', swap.from_operator)
    .eq('work_date', swap.work_date)

  if (moveError) {
    return NextResponse.json(
      { error: 'Не вдалося перенести день — можливо, він уже зайнятий' },
      { status: 409 },
    )
  }

  await supabase.from('shift_swaps').update({
    ...patch, status: 'approved', resolved_by: actor.id, resolved_at: now,
  }).eq('id', id)

  const [fromName, toName] = await Promise.all([
    nameOf(supabase, swap.from_operator), nameOf(supabase, swap.to_operator),
  ])
  await notify(supabase, [swap.from_operator, swap.to_operator, ...(await approvers(supabase))], {
    type: 'swap_approved',
    title: 'Заміну підтверджено',
    body: `${dayLabel(swap.work_date)} — ${fromName} → ${toName}`,
    actorId: actor.id,
  })

  return NextResponse.json({ ok: true, status: 'approved' })
}

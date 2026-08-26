/**
 * GET /api/cron/schedule-reminder
 *
 * Friday nudge: if next week's schedule has not been handed in, tell the
 * operators, and once the 16:00 deadline has passed tell management too.
 *
 * Runs more than once on a Friday, so it must not nag on every pass — a
 * reminder is skipped when one already went out for that week today.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { isOverdue, kyivNow, nextWeekStart, weekLabel, DEADLINE_WEEKDAY } from '@/lib/schedule'
import { approvers, notify, operators } from '@/lib/schedule-notify'

export async function GET(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret')
    || req.headers.get('authorization')?.replace('Bearer ', '')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = kyivNow()
  if (now.weekday !== DEADLINE_WEEKDAY) {
    return NextResponse.json({ skipped: 'не пʼятниця' })
  }

  const week = nextWeekStart()
  const supabase = createServiceClient()

  const { data: schedule } = await supabase
    .from('work_schedules').select('status').eq('week_start', week).maybeSingle()

  // Submitted or approved — nothing to chase
  if (schedule && schedule.status !== 'draft') {
    return NextResponse.json({ skipped: 'графік уже подано', status: schedule.status })
  }

  const late = isOverdue()
  const type = late ? 'schedule_overdue' : 'schedule_due'

  // One reminder of each kind per day, however often the job runs
  const since = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()
  const { count } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('type', type)
    .gte('created_at', since)
  if (count) return NextResponse.json({ skipped: 'уже нагадували сьогодні' })

  const label = weekLabel(week)
  await notify(supabase, await operators(supabase), {
    type,
    title: late ? 'Графік прострочено' : 'Час скласти графік',
    body: late
      ? `Графік на ${label} мав бути до 16:00. Складіть його якнайшвидше.`
      : `Не забудьте подати графік на ${label} — дедлайн сьогодні до 16:00.`,
    link: `/operators/schedule?week=${week}`,
  })

  if (late) {
    await notify(supabase, await approvers(supabase), {
      type,
      title: 'Графік не подано',
      body: `Оператори не подали графік на ${label} до 16:00.`,
      link: `/operators/schedule?week=${week}`,
    })
  }

  return NextResponse.json({ ok: true, week, late })
}

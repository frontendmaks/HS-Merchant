/**
 * The operators' working week.
 *
 * Weeks start on Monday and are named by that Monday's date. Everything here
 * works off calendar dates in Kyiv rather than timestamps: a shift belongs to a
 * day, not to a moment, and treating it as a moment is how a Sunday night shift
 * ends up in the wrong week for anyone whose clock is not on Kyiv time.
 *
 * Pure — no server imports, so the client uses the same week maths as the API.
 */

export const KYIV = 'Europe/Kyiv'

export type ScheduleStatus = 'draft' | 'submitted' | 'approved'
export type SwapStatus = 'pending' | 'approved' | 'declined' | 'canceled'

export const STATUS_LABELS: Record<ScheduleStatus, string> = {
  draft: 'Чернетка',
  submitted: 'На підтвердженні',
  approved: 'Затверджено',
}

export const WEEKDAYS = [
  'Понеділок', 'Вівторок', 'Середа', 'Четвер', "П'ятниця", 'Субота', 'Неділя',
]

/** Operators must hand next week in by Friday at this hour, Kyiv time. */
export const DEADLINE_WEEKDAY = 5   // Friday, ISO numbering
export const DEADLINE_HOUR = 16

/** Today's date in Kyiv as YYYY-MM-DD, whatever the caller's own clock says. */
export function kyivToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: KYIV, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

/** Kyiv wall-clock parts, for deadline questions. */
export function kyivNow(now: Date = new Date()): { date: string; hour: number; minute: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: KYIV, hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  }).formatToParts(now)
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  const NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  return {
    date: kyivToday(now),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    weekday: NAMES.indexOf(get('weekday')) + 1,
  }
}

// --- date arithmetic, on YYYY-MM-DD strings ------------------------------
// Done at noon UTC so a daylight-saving shift can never nudge the date across
// a midnight boundary.

const toUtcNoon = (ymd: string): Date => {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12))
}

const fromUtc = (d: Date): string => d.toISOString().slice(0, 10)

export function addDays(ymd: string, days: number): string {
  const d = toUtcNoon(ymd)
  d.setUTCDate(d.getUTCDate() + days)
  return fromUtc(d)
}

/** ISO weekday: Monday 1 … Sunday 7. */
export function weekdayOf(ymd: string): number {
  const wd = toUtcNoon(ymd).getUTCDay()   // Sunday 0
  return wd === 0 ? 7 : wd
}

/** The Monday of the week `ymd` falls in. */
export const weekStartOf = (ymd: string): string => addDays(ymd, 1 - weekdayOf(ymd))

/** The seven dates of a week, Monday first. */
export const weekDates = (weekStart: string): string[] =>
  Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

export const thisWeekStart = (now: Date = new Date()): string => weekStartOf(kyivToday(now))
export const nextWeekStart = (now: Date = new Date()): string => addDays(thisWeekStart(now), 7)

/** "24.08" — the column heading. */
export function dayLabel(ymd: string): string {
  const [, m, d] = ymd.split('-')
  return `${d}.${m}`
}

/** "25 — 31 серпня" for a week heading. */
const MONTHS = [
  'січня', 'лютого', 'березня', 'квітня', 'травня', 'червня',
  'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня',
]

export function weekLabel(weekStart: string): string {
  const end = addDays(weekStart, 6)
  const [, sm, sd] = weekStart.split('-')
  const [ey, em, ed] = end.split('-')
  const from = sm === em ? String(Number(sd)) : `${Number(sd)} ${MONTHS[Number(sm) - 1]}`
  return `${from} — ${Number(ed)} ${MONTHS[Number(em) - 1]} ${ey}`
}

/**
 * Whether next week's schedule is already overdue.
 *
 * The deadline is Friday 16:00 of the current week, so it only bites from
 * Friday afternoon onwards — before that the week is simply still open.
 */
export function isOverdue(now: Date = new Date()): boolean {
  const { weekday, hour } = kyivNow(now)
  if (weekday > DEADLINE_WEEKDAY) return true
  if (weekday < DEADLINE_WEEKDAY) return false
  return hour >= DEADLINE_HOUR
}

/** Who may approve a schedule or the manager half of a swap. */
export const canApprove = (role: string | null | undefined): boolean =>
  ['super_admin', 'admin', 'manager'].includes(role ?? '')

/** A week already in the past is a record, not a plan. */
export const isPastWeek = (weekStart: string, now: Date = new Date()): boolean =>
  weekStart < thisWeekStart(now)

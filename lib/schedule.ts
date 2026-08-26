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

/** The status names who holds the pen, not merely how far along it is. */
export type ScheduleStatus =
  | 'draft'             // operators are filling it in
  | 'review_manager'    // handed up, management is looking
  | 'editing_manager'   // management is amending it
  | 'review_operators'  // handed back down, operators are looking
  | 'approved'          // agreed by both sides

export type SwapStatus = 'pending' | 'approved' | 'declined' | 'canceled'

export const STATUS_LABELS: Record<ScheduleStatus, string> = {
  draft: 'Складається',
  review_manager: 'На затвердженні',
  editing_manager: 'Керівник вносить зміни',
  review_operators: 'На розгляді в операторів',
  approved: 'Затверджено',
}

export const STATUS_TONES: Record<ScheduleStatus, string> = {
  draft: 'bg-zinc-800 text-zinc-400',
  review_manager: 'bg-amber-950/60 text-amber-300',
  editing_manager: 'bg-sky-950/60 text-sky-300',
  review_operators: 'bg-amber-950/60 text-amber-300',
  approved: 'bg-emerald-950/60 text-emerald-400',
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

// --- who may do what -----------------------------------------------------
//
// Three roles run the schedule: operators propose it, management agrees it.
// Everyone else may look. Super admins count as management — locking the owner
// out of their own panel would be a bug, not a policy.

const MANAGEMENT = ['super_admin', 'admin', 'manager']

/** Management: reviews, amends and approves. */
export const canApprove = (role: string | null | undefined): boolean =>
  MANAGEMENT.includes(role ?? '')

/** Operators: propose the week and answer amendments. */
export const isOperatorRole = (role: string | null | undefined): boolean =>
  role === 'operator'

/** Anyone who takes part at all. The rest see a read-only grid with no
 *  buttons — not disabled ones, none. */
export const canParticipate = (role: string | null | undefined): boolean =>
  canApprove(role) || isOperatorRole(role)

/** Whose turn it is to hold the pen in this status. */
export function holdsPen(status: ScheduleStatus, role: string | null | undefined): boolean {
  if (!canParticipate(role)) return false
  switch (status) {
    // Either side may start a week off; whoever does, operators own the draft
    case 'draft': return true
    case 'editing_manager': return canApprove(role)
    case 'review_manager': return false
    case 'review_operators': return false
    case 'approved': return false
  }
}

export type ScheduleAction = 'submit' | 'approve' | 'amend' | 'send_back' | 'agree'

export const ACTION_LABELS: Record<ScheduleAction, string> = {
  submit: 'Надіслати на затвердження',
  approve: 'Затвердити',
  amend: 'Внести зміни',
  send_back: 'Надіслати операторам',
  agree: 'Погодитись',
}

/** The buttons this person should see in this status — and no others. */
export function actionsFor(
  status: ScheduleStatus,
  role: string | null | undefined,
  editable: boolean,
): ScheduleAction[] {
  if (!canParticipate(role) || !editable) return []
  const management = canApprove(role)

  switch (status) {
    case 'draft':
      return ['submit']
    case 'review_manager':
      return management ? ['approve', 'amend'] : []
    case 'editing_manager':
      return management ? ['send_back'] : []
    case 'review_operators':
      // Management can settle it from here too, rather than waiting on a reply
      return isOperatorRole(role) ? ['agree', 'amend'] : management ? ['approve'] : []
    case 'approved':
      return []
  }
}

/** A week already in the past is a record, not a plan. */
export const isPastWeek = (weekStart: string, now: Date = new Date()): boolean =>
  weekStart < thisWeekStart(now)

/** Planning reaches one week ahead and no further. Past weeks stay readable. */
export const isPlannable = (weekStart: string, now: Date = new Date()): boolean =>
  weekStart >= thisWeekStart(now) && weekStart <= nextWeekStart(now)

/** The last week the picker may offer. */
export const maxPlannableWeek = (now: Date = new Date()): string => nextWeekStart(now)

export const EVENT_LABELS: Record<string, string> = {
  submitted: 'надіслав на затвердження',
  approved: 'затвердив графік',
  amend: 'взяв графік на правки',
  sent_back: 'надіслав операторам на розгляд',
  agreed: 'погодив графік',
  edited: 'змінив графік',
}

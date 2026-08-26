/**
 * Elapsed working time between two instants.
 *
 * Timestamps are stored in UTC, the schedule is local, and Kyiv shifts between
 * UTC+2 and UTC+3 — so the window is resolved per day through the timezone
 * database rather than by adding a fixed offset.
 */

export const WORK_TZ = 'Europe/Kyiv'
export const WORK_START_HOUR = 9
export const WORK_END_HOUR = 17
export const SHIFT_MINUTES = (WORK_END_HOUR - WORK_START_HOUR) * 60

const partsIn = (at: Date, timeZone: string) => {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const p = Object.fromEntries(f.formatToParts(at).map(x => [x.type, x.value])) as Record<string, string>
  return {
    year: +p.year, month: +p.month, day: +p.day,
    hour: +p.hour % 24, minute: +p.minute, second: +p.second,
  }
}

/** Minutes the zone is ahead of UTC at that instant. */
function offsetMinutes(at: Date, timeZone: string): number {
  const p = partsIn(at, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return (asUtc - at.getTime()) / 60000
}

/** The local calendar date of an instant, as YYYY-MM-DD. */
export function localDate(at: Date, timeZone = WORK_TZ): string {
  const p = partsIn(at, timeZone)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

/** The UTC instant of a given local wall-clock hour on the local day of `at`. */
function localHourToUtc(at: Date, hour: number, timeZone: string): number {
  const p = partsIn(at, timeZone)
  // Offset can differ across a DST boundary, so resolve it twice
  let guess = Date.UTC(p.year, p.month - 1, p.day, hour, 0, 0) - offsetMinutes(at, timeZone) * 60000
  const refined = Date.UTC(p.year, p.month - 1, p.day, hour, 0, 0)
    - offsetMinutes(new Date(guess), timeZone) * 60000
  guess = refined
  return guess
}

/**
 * Minutes of working time between two instants, counting only the hours an
 * operator is on shift. Anything overnight or before the shift starts is not
 * their waiting time and would otherwise dwarf the real figure.
 *
 * Returns null when the inputs make no sense (missing or reversed).
 */
export function businessMinutes(
  fromIso: string | null | undefined,
  toIso: string | null | undefined,
  opts: {
    startHour?: number
    endHour?: number
    timeZone?: string
    /** Dates (YYYY-MM-DD, Kyiv) the operator was rostered. Days outside it are
     *  not their time, so they do not count — without this a Sunday would be
     *  charged to whoever happened to answer on Monday. */
    workDates?: Set<string>
  } = {},
): number | null {
  if (!fromIso || !toIso) return null
  const from = new Date(fromIso).getTime()
  const to = new Date(toIso).getTime()
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null

  const startHour = opts.startHour ?? WORK_START_HOUR
  const endHour = opts.endHour ?? WORK_END_HOUR
  const tz = opts.timeZone ?? WORK_TZ

  let total = 0
  // Walk day by day in local time; a shift never spans midnight here
  let cursor = from
  let guard = 0

  while (cursor < to && guard++ < 400) {
    const day = new Date(cursor)
    const open = localHourToUtc(day, startHour, tz)
    const close = localHourToUtc(day, endHour, tz)

    const windowStart = Math.max(cursor, open)
    const windowEnd = Math.min(to, close)
    const rostered = !opts.workDates || opts.workDates.has(localDate(day, tz))
    if (rostered && windowEnd > windowStart) total += (windowEnd - windowStart) / 60000

    // Jump to the start of the next local day
    const nextDay = localHourToUtc(new Date(close + 12 * 3600_000), startHour, tz)
    cursor = nextDay > cursor ? nextDay : cursor + 24 * 3600_000
  }

  return Math.round(total)
}

/**
 * Minutes actually spent with the panel open during rostered shifts.
 *
 * Reconstructed from the heartbeat trail: consecutive ticks close enough
 * together are one stretch of being present, and a longer gap means they were
 * away. Counting ticks instead would charge a full interval to somebody who
 * looked in once, which is the opposite of the truth.
 */
export function onlineMinutes(
  ticks: string[],
  workDates: Set<string>,
  opts: { startHour?: number; endHour?: number; timeZone?: string; maxGapMin?: number } = {},
): number {
  const startHour = opts.startHour ?? WORK_START_HOUR
  const endHour = opts.endHour ?? WORK_END_HOUR
  const tz = opts.timeZone ?? WORK_TZ
  // The heartbeat is every three minutes; twice that allows one missed beat
  const maxGap = (opts.maxGapMin ?? 7) * 60000

  const times = ticks
    .map(t => new Date(t).getTime())
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
  if (times.length < 2) return 0

  let total = 0
  for (let i = 1; i < times.length; i++) {
    const gap = times[i] - times[i - 1]
    if (gap <= 0 || gap > maxGap) continue

    // Charge the stretch only where it overlaps a rostered shift
    const day = new Date(times[i - 1])
    if (!workDates.has(localDate(day, tz))) continue
    const open = localHourToUtc(day, startHour, tz)
    const close = localHourToUtc(day, endHour, tz)
    const from = Math.max(times[i - 1], open)
    const to = Math.min(times[i], close)
    if (to > from) total += (to - from) / 60000
  }
  return Math.round(total)
}

/**
 * Rostered minutes that have actually elapsed.
 *
 * A shift still in the future is not time anyone failed to show up for, so it
 * must not count against them. Today counts only up to now.
 */
export function elapsedShiftMinutes(
  workDates: Set<string>,
  now: Date = new Date(),
  opts: {
    startHour?: number
    endHour?: number
    timeZone?: string
    /** Nothing before this was recorded, so it cannot be held against anyone.
     *  Without it a shift worked before the heartbeat existed reads as an
     *  absence rather than as an unknown. */
    measuredSince?: Date | null
  } = {},
): number {
  const startHour = opts.startHour ?? WORK_START_HOUR
  const endHour = opts.endHour ?? WORK_END_HOUR
  const tz = opts.timeZone ?? WORK_TZ
  const today = localDate(now, tz)
  const since = opts.measuredSince?.getTime() ?? -Infinity

  let total = 0
  for (const date of workDates) {
    if (date > today) continue

    // Resolve the shift's own window on that date rather than assuming a
    // fixed offset — Kyiv moves between UTC+2 and UTC+3
    const noon = new Date(`${date}T12:00:00Z`)
    const open = localHourToUtc(noon, startHour, tz)
    const close = localHourToUtc(noon, endHour, tz)

    const from = Math.max(open, since)
    const to = Math.min(close, now.getTime())
    if (to > from) total += (to - from) / 60000
  }
  return Math.round(total)
}

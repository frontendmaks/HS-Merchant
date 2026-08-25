/**
 * Elapsed working time between two instants.
 *
 * Timestamps are stored in UTC, the schedule is local, and Kyiv shifts between
 * UTC+2 and UTC+3 — so the window is resolved per day through the timezone
 * database rather than by adding a fixed offset.
 */

export const WORK_TZ = 'Europe/Kyiv'
export const WORK_START_HOUR = 8
export const WORK_END_HOUR = 17

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
  opts: { startHour?: number; endHour?: number; timeZone?: string } = {},
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
    if (windowEnd > windowStart) total += (windowEnd - windowStart) / 60000

    // Jump to the start of the next local day
    const nextDay = localHourToUtc(new Date(close + 12 * 3600_000), startHour, tz)
    cursor = nextDay > cursor ? nextDay : cursor + 24 * 3600_000
  }

  return Math.round(total)
}

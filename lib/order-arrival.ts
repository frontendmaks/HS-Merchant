/**
 * When an order was actually placed, as the shop reads a clock.
 *
 * Not orders.created_at — that is when our sync noticed it, which trails the
 * real thing by up to five minutes and would be wrong to show as the order
 * time. Each marketplace stamps its own, and they do not agree on the zone:
 *
 *   MauDau   raw.created_at  "2026-08-26T09:37:04Z"  — UTC, needs converting
 *   Rozetka  raw.created     "2026-07-25 07:15:06"   — already Kyiv, must not be
 *
 * Verified against five orders of each: MauDau's stamp sits 1–5 minutes before
 * our sync row, while Rozetka's sits exactly three hours ahead of it in summer.
 * Reading Rozetka's as UTC would put every order three hours late.
 */

const KYIV = 'Europe/Kyiv'

/** "HH:mm" in Kyiv time, or null when the marketplace gave us nothing. */
export function arrivalTime(
  platform: string | null,
  raw: unknown,
): string | null {
  const r = (raw ?? {}) as Record<string, unknown>

  if (platform === 'rozetka') {
    const s = r.created
    if (typeof s !== 'string') return null
    // Already local — read the clock off the string rather than converting
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(s.trim())
    return m ? `${m[4]}:${m[5]}` : null
  }

  const s = r.created_at
  if (typeof s !== 'string') return null
  const at = new Date(s)
  if (Number.isNaN(at.getTime())) return null
  return new Intl.DateTimeFormat('uk-UA', {
    timeZone: KYIV, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(at)
}

/**
 * The instant an order was placed, as a UTC ISO string.
 *
 * Same trap as arrivalTime(): MauDau's stamp is UTC, Rozetka's is Kyiv
 * wall-clock with nothing to say so. Reading Rozetka's as UTC would date every
 * one of its orders three hours late, which in a reaction time is the whole
 * measurement.
 */
export function placedAtIso(
  platform: string | null,
  mdPlaced: string | null | undefined,
  rzPlaced: string | null | undefined,
): string | null {
  if (platform === 'rozetka') {
    if (!rzPlaced) return null
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(rzPlaced.trim())
    if (!m) return null
    const [, y, mo, d, h, mi, sec] = m
    return kyivWallClockToUtc(+y, +mo, +d, +h, +mi, +(sec ?? 0))
  }
  if (!mdPlaced) return null
  const at = new Date(mdPlaced)
  return Number.isNaN(at.getTime()) ? null : at.toISOString()
}

/** Kyiv wall-clock to the UTC instant it names. The offset is resolved twice
 *  because it can itself differ across a daylight-saving boundary. */
function kyivWallClockToUtc(
  y: number, mo: number, d: number, h: number, mi: number, s: number,
): string {
  const naive = Date.UTC(y, mo - 1, d, h, mi, s)
  const offsetAt = (t: number) => {
    const p = new Intl.DateTimeFormat('en-US', {
      timeZone: KYIV, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(t))
    const g = (k: string) => Number(p.find(x => x.type === k)?.value ?? 0)
    return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second')) - t
  }
  let utc = naive - offsetAt(naive)
  utc = naive - offsetAt(utc)
  return new Date(utc).toISOString()
}

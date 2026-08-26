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

// Deterministic formatters.
//
// Intl output differs between the Node build and the browser (grouping spaces
// in particular), which shows up as a React hydration mismatch. These produce
// identical strings on both sides.

/** 1234567.5 -> "1 234 567,50" */
export function num(value: number, decimals = 0): string {
  const n = Number.isFinite(value) ? value : 0
  const fixed = Math.abs(n).toFixed(decimals)
  const [whole, frac] = fixed.split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return `${n < 0 ? '−' : ''}${grouped}${frac ? `,${frac}` : ''}`
}

export const money = (value: number) => `₴${num(value, 2)}`
export const moneyShort = (value: number) => `₴${num(Math.round(value))}`

export const pct = (part: number, total: number) =>
  total ? `${((part / total) * 100).toFixed(1)}%` : '0%'

/** "2026-08-24" -> "24.08" */
export function dayMonth(iso: string): string {
  const [, m, d] = iso.split('-')
  return d && m ? `${d}.${m}` : iso
}

/** Ukrainian plural: 1 замовлення, 2 замовлення, 5 замовлень. */
export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100
  const last = abs % 10
  if (abs > 10 && abs < 20) return many
  if (last > 1 && last < 5) return few
  if (last === 1) return one
  return many
}

export const orderWord = (n: number) => plural(n, 'замовлення', 'замовлення', 'замовлень')

/** How long ago something happened, in words — "12 хв тому", "вчора о 18:20".
 *  Falls back to a date once it stops being useful to count backwards. */
export function timeAgo(iso: string | null | undefined, now = new Date()): string | null {
  if (!iso) return null
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null

  const mins = Math.floor((now.getTime() - at.getTime()) / 60000)
  if (mins < 0) return 'щойно'          // a clock skewed a little ahead
  if (mins < 1) return 'щойно'
  if (mins < 60) return `${mins} ${plural(mins, 'хвилину', 'хвилини', 'хвилин')} тому`

  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} ${plural(hours, 'годину', 'години', 'годин')} тому`

  // Days apart by the calendar in Kyiv, not by dividing hours — 23:50 and 00:10
  // are one day apart, not zero.
  const kyivDay = (d: Date) => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
  const at_ = kyivDay(at)
  const clock = new Intl.DateTimeFormat('uk-UA', {
    timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(at)

  const yesterday = new Date(now.getTime() - 86_400_000)
  if (at_ === kyivDay(yesterday)) return `вчора о ${clock}`

  const [y, m, d] = at_.split('-')
  const sameYear = at_.slice(0, 4) === kyivDay(now).slice(0, 4)
  return sameYear ? `${d}.${m} о ${clock}` : `${d}.${m}.${y}`
}

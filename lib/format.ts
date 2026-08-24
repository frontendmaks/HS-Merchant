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

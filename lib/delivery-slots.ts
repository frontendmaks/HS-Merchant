/**
 * Коли можна привезти замовлення.
 *
 * Три періоди на день і буфер перед кожним: за двадцять хвилин до початку
 * період закривається, бо складу потрібен час зібрати й віддати кур'єру.
 * Клієнт о 10:50 вибирає з другого й третього, а не з першого.
 */

export interface Slot {
  /** «11:00-14:00» — те, що бачить і оператор, і клієнт */
  label: string
  from: string
  to: string
}

export const SLOTS: Slot[] = [
  { label: '11:00-14:00', from: '11:00', to: '14:00' },
  { label: '14:00-17:00', from: '14:00', to: '17:00' },
  { label: '17:00-20:00', from: '17:00', to: '20:00' },
]

/** Скільки хвилин до початку періоду він ще приймає замовлення. */
export const BUFFER_MINUTES = 20

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** Котра зараз година у Києві, у хвилинах від опівночі. */
export function kyivMinutesNow(now = new Date()): number {
  const parts = new Intl.DateTimeFormat('uk-UA', {
    timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now)
  const h = Number(parts.find(p => p.type === 'hour')?.value ?? 0)
  const m = Number(parts.find(p => p.type === 'minute')?.value ?? 0)
  return h * 60 + m
}

/** Сьогоднішня дата у Києві як YYYY-MM-DD. */
export function kyivToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

export interface SlotAvailability extends Slot {
  available: boolean
  /** Чому недоступний — показується поруч, щоб не здавалось поломкою */
  reason: string | null
}

/**
 * Які періоди доступні на вказану дату.
 *
 * Для майбутніх днів доступні всі. Для сьогодні відпадають ті, до початку
 * яких лишилось менше за буфер — і ті, що вже тривають або минули.
 */
export function slotsForDate(date: string, now = new Date()): SlotAvailability[] {
  const today = kyivToday(now)

  if (date < today) {
    return SLOTS.map(s => ({ ...s, available: false, reason: 'дата минула' }))
  }
  if (date > today) {
    return SLOTS.map(s => ({ ...s, available: true, reason: null }))
  }

  const nowMin = kyivMinutesNow(now)
  return SLOTS.map(s => {
    const starts = minutesOf(s.from)
    const closesAt = starts - BUFFER_MINUTES
    if (nowMin >= minutesOf(s.to)) return { ...s, available: false, reason: 'період минув' }
    if (nowMin >= closesAt) {
      return { ...s, available: false, reason: `приймали до ${fmt(closesAt)}` }
    }
    return { ...s, available: true, reason: null }
  })
}

const fmt = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

/** Перша дата й період, які ще можна обрати — те, що форма підставляє одразу. */
export function firstAvailable(now = new Date()): { date: string; slot: string } {
  const today = kyivToday(now)
  const free = slotsForDate(today, now).find(s => s.available)
  if (free) return { date: today, slot: free.label }

  const tomorrow = new Date(now.getTime() + 864e5)
  return { date: kyivToday(tomorrow), slot: SLOTS[0].label }
}

export const isValidSlot = (label: string) => SLOTS.some(s => s.label === label)

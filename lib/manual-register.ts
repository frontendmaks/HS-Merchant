/**
 * Порядковий номер із паперового журналу.
 *
 * Журнал ведеться в Google-таблиці, і він спільний: туди пишуть і з Мерчанта,
 * і руками. Тому номер беремо звідти, а не вигадуємо свій — інакше два
 * джерела нумерації розійдуться вже на першому дні.
 *
 * Якщо таблиця недоступна — замовлення все одно приймається з власним
 * номером. Втратити замовлення через чужий недоступний сервіс було б гірше,
 * ніж мати потім розбіжність у журналі, яку видно й можна виправити.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { readRange, writeCell, sheetsConfigured } from '@/lib/google-sheets'
import { nextManualNumber } from '@/lib/manual-orders'

type Service = ReturnType<typeof createServiceClient>

/** «2026-10-19» → «19.10», як названо вкладку. */
export const tabNameFor = (date: string) => {
  const [, m, d] = date.split('-')
  return `${d}.${m}`
}

const monthOf = (date: string) => `${date.slice(0, 7)}-01`

async function registerFor(service: Service, date: string): Promise<string | null> {
  const { data } = await service
    .from('manual_order_registers')
    .select('spreadsheet_id')
    .eq('month', monthOf(date))
    .maybeSingle()
  return (data?.spreadsheet_id as string) ?? null
}

export interface ReservedNumber {
  number: number
  source: 'sheet' | 'local'
  /** Що саме завадило взяти номер із журналу */
  note: string | null
}

/**
 * Перший вільний номер і запис імені навпроти нього.
 *
 * Вільний — це перший рядок, де колонка «ПІБ» порожня. Колір комірки до уваги
 * не береться: червоним там позначають щось своє, але ім'я в такому рядку
 * стоїть, тобто номер зайнятий.
 *
 * Між читанням і записом хтось міг зайняти рядок руками, тому перед записом
 * комірка перечитується. Вікно лишається крихітним, і для журналу телефонних
 * замовлень цього досить.
 */
export async function reserveNumber(
  service: Service,
  date: string,
  customerName: string,
): Promise<ReservedNumber> {
  const fallback = async (note: string): Promise<ReservedNumber> => ({
    number: await nextManualNumber(service, date),
    source: 'local',
    note,
  })

  if (!sheetsConfigured()) {
    return fallback('Доступ до Google-таблиці не налаштовано')
  }

  const spreadsheetId = await registerFor(service, date)
  if (!spreadsheetId) {
    return fallback(`Таблицю на ${date.slice(0, 7)} не вказано`)
  }

  const tab = tabNameFor(date)

  for (let attempt = 0; attempt < 3; attempt++) {
    const rows = await readRange(spreadsheetId, `'${tab}'!A1:B300`)
    if (!rows) return fallback('Таблиця не відповіла')

    // Рядок 1 — заголовки; шукаємо перший із номером і порожнім ПІБ
    let targetRow = -1
    let number = 0
    for (let i = 1; i < rows.length; i++) {
      const n = Number((rows[i]?.[0] ?? '').toString().trim())
      const name = (rows[i]?.[1] ?? '').toString().trim()
      if (!Number.isFinite(n) || n <= 0) continue
      if (!name) { targetRow = i + 1; number = n; break }
    }

    if (targetRow < 0) {
      return fallback(`У вкладці ${tab} не лишилось вільних номерів`)
    }

    // Перечитуємо саме цю комірку — раптом її щойно зайняли
    const fresh = await readRange(spreadsheetId, `'${tab}'!B${targetRow}`)
    if (fresh?.[0]?.[0]?.toString().trim()) continue

    const written = await writeCell(spreadsheetId, `'${tab}'!B${targetRow}`, customerName)
    if (!written) return fallback('Не вдалося записати в таблицю')

    return { number, source: 'sheet', note: null }
  }

  return fallback('Номер зайняли під час запису — спробуйте ще раз')
}

/** Чи готовий журнал до роботи — для підказки в інтерфейсі. */
export async function registerStatus(service: Service, date: string) {
  if (!sheetsConfigured()) {
    return { ready: false, note: 'Доступ до Google-таблиці не налаштовано' }
  }
  const spreadsheetId = await registerFor(service, date)
  if (!spreadsheetId) {
    return { ready: false, note: `Таблицю на ${date.slice(0, 7)} не вказано` }
  }
  const rows = await readRange(spreadsheetId, `'${tabNameFor(date)}'!A1:B1`)
  return rows
    ? { ready: true, note: null }
    : { ready: false, note: `Вкладки ${tabNameFor(date)} немає або немає доступу` }
}

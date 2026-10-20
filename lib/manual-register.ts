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
 * Номери, які ми вже видали на цю дату — хай навіть у таблиці їх стерли.
 *
 * Рахуємо ті, що видали самі: телефонні замовлення й сайтові, яким номер
 * проставила система. Номери, що приїхали з Бітрікса вже готовими, до уваги
 * не беремо — там те саме число трапляється двічі за добу, і це чужа
 * нумерація, не журнальна.
 */
async function takenNumbers(service: Service, date: string): Promise<Set<number>> {
  const { data } = await service
    .from('orders')
    .select('manual_number')
    .eq('delivery_date', date)
    .not('manual_number', 'is', null)
    .not('number_source', 'is', null)

  return new Set((data ?? []).map(o => Number(o.manual_number)))
}

/**
 * Наступний номер за журналом — і запис імені навпроти нього.
 *
 * Номер береться з кінця: перший порожній рядок **після останнього
 * заповненого**. Журнал читають згори вниз і зверяються з ним на складі, тож
 * нове замовлення має ставати в кінець черги, а не в діру посередині, яку
 * хтось лишив свідомо.
 *
 * Діру все ж використовуємо — але тільки якщо далі місця немає: краще
 * повторно зайняти звільнений рядок, ніж не видати номер узагалі.
 *
 * Рядок, номер якого вже тримає наше замовлення, оминаємо: порожня комірка
 * там означає не «вільно», а «ім'я стерли», і два замовлення під одним
 * номером на складі не розрізнити.
 *
 * Колір комірки до уваги не береться: червоним там позначають щось своє, але
 * ім'я в такому рядку стоїть, тобто номер зайнятий.
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
  const taken = await takenNumbers(service, date)

  for (let attempt = 0; attempt < 3; attempt++) {
    const rows = await readRange(spreadsheetId, `'${tab}'!A1:B300`)
    if (!rows) return fallback('Таблиця не відповіла')

    // Рядок 1 — заголовки. Збираємо всі придатні рядки й окремо запам'ятовуємо,
    // де закінчується заповнена частина журналу
    const free: { row: number; number: number }[] = []
    let lastFilled = 0

    for (let i = 1; i < rows.length; i++) {
      const n = Number((rows[i]?.[0] ?? '').toString().trim())
      const name = (rows[i]?.[1] ?? '').toString().trim()
      if (!Number.isFinite(n) || n <= 0) continue

      if (name) { lastFilled = i; continue }
      // Номер, який уже тримає наше замовлення, вільним не вважаємо
      if (taken.has(n)) continue
      free.push({ row: i + 1, number: n })
    }

    // Спершу — те, що за останнім заповненим рядком; якщо там порожньо,
    // вертаємось до дір вище
    const target = free.find(f => f.row > lastFilled + 1) ?? free[0]

    if (!target) {
      return fallback(`У вкладці ${tab} не лишилось вільних номерів`)
    }

    const { row: targetRow, number } = target
    const note = targetRow <= lastFilled
      ? 'Номер узято з вільного рядка всередині журналу'
      : null

    // Перечитуємо саме цю комірку — раптом її щойно зайняли
    const fresh = await readRange(spreadsheetId, `'${tab}'!B${targetRow}`)
    if (fresh?.[0]?.[0]?.toString().trim()) continue

    const written = await writeCell(spreadsheetId, `'${tab}'!B${targetRow}`, customerName)
    if (!written) return fallback('Не вдалося записати в таблицю')

    return { number, source: 'sheet', note }
  }

  return fallback('Номер зайняли під час запису — спробуйте ще раз')
}

/**
 * Переносить номер замовлення з одного дня на інший.
 *
 * Замовлення переносять цілком — разом із номером, під яким його знають на
 * складі й у розмові. Тож у журналі воно має зникнути з учорашнього аркуша
 * й з'явитись на завтрашньому під тим самим числом.
 *
 * Якщо на новий день цей номер уже зайнятий, нічого не переписуємо: чуже
 * замовлення в журналі важливіше за наше бажання зберегти число. Тоді
 * повертаємо пояснення, і номер лишається старий.
 */
export async function moveNumber(
  service: Service,
  { number, fromDate, toDate, customerName }: {
    number: number
    fromDate: string
    toDate: string
    customerName: string
  },
): Promise<{ ok: boolean; note: string | null }> {
  if (!sheetsConfigured()) return { ok: false, note: 'Журнал недоступний' }

  const [fromSheet, toSheet] = await Promise.all([
    registerFor(service, fromDate),
    registerFor(service, toDate),
  ])
  if (!fromSheet || !toSheet) return { ok: false, note: 'Таблицю на ці дати не вказано' }

  const rowOf = async (sheetId: string, date: string) => {
    const rows = await readRange(sheetId, `'${tabNameFor(date)}'!A1:B300`)
    if (!rows) return null
    for (let i = 1; i < rows.length; i++) {
      if (Number((rows[i]?.[0] ?? '').toString().trim()) === number) {
        return { row: i + 1, name: (rows[i]?.[1] ?? '').toString().trim() }
      }
    }
    return null
  }

  const target = await rowOf(toSheet, toDate)
  if (!target) return { ok: false, note: `У вкладці ${tabNameFor(toDate)} немає рядка ${number}` }
  if (target.name) {
    return {
      ok: false,
      note: `Номер ${number} на ${tabNameFor(toDate)} зайнятий — «${target.name}»`,
    }
  }

  const written = await writeCell(
    toSheet, `'${tabNameFor(toDate)}'!B${target.row}`, customerName,
  )
  if (!written) return { ok: false, note: 'Не вдалося записати в журнал' }

  // Старий рядок звільняємо після запису нового: якщо щось піде не так,
  // замовлення лишиться видимим бодай в одному дні
  const source = await rowOf(fromSheet, fromDate)
  if (source?.row) {
    await writeCell(fromSheet, `'${tabNameFor(fromDate)}'!B${source.row}`, '')
  }

  return { ok: true, note: null }
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

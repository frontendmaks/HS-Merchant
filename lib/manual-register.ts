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
import { takeNumber, freeNumber, nextFreeNumber } from '@/lib/number-register'
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

/**
 * Той самий запис, але в нашому журналі.
 *
 * Пишемо в обидва місця: таблиця лишається головною для складу, а наш
 * журнал пам'ятає, хто взяв номер, коли й за яким замовленням — у
 * таблиці цього не спитати.
 */
async function noteTaken(
  service: Service,
  date: string,
  number: number,
  customerName: string,
  orderId: string | null = null,
): Promise<boolean> {
  return await takeNumber(service, { date, number, orderId, customerName })
}

/**
 * Дописує журналу, кому дістався номер.
 *
 * Номер резервують до того, як замовлення існує: спершу треба знати
 * число, щоб вписати його в угоду й на бланк. Через це в журналі
 * лишався рядок «зайнято, а ким — невідомо», і при розборі дня з нього
 * нічого не можна було дізнатись.
 */
export async function linkNumber(
  service: Service,
  { date, number, orderId }: { date: string; number: number; orderId: string },
): Promise<void> {
  await service.from('order_numbers')
    .update({ order_id: orderId })
    .eq('delivery_date', date).eq('number', number).is('released_at', null)
    .is('order_id', null)
}

export interface ReservedNumber {
  number: number
  source: 'sheet' | 'local'
  /** Що саме завадило взяти номер із журналу */
  note: string | null
}

/**
 * Номери, які цього дня вже за кимось, — хай навіть у таблиці їх стерли.
 *
 * Рахуємо всі: і видані нами, і проставлені в 1С. Раніше чужі номери
 * оминали, бо «там своя нумерація», — і журнал видавав число, яке 1С
 * уже зайняла. На складі від цього два ящики з однаковим номером, і
 * розрізнити їх нема як.
 *
 * Скасовані не рахуємо: їхній ящик нікуди не поїде, і тримати за ними
 * номер означає гнати нумерацію дня вперед на порожньому місці.
 */
async function takenNumbers(service: Service, date: string): Promise<Set<number>> {
  /*
   * Три джерела, і жодному з них не можна вірити окремо.
   *
   * Аркуш каже, що рядок порожній, — а його тримає живе замовлення, бо
   * ім'я звідти стерли руками. Журнал каже, що номер вільний, — а в
   * аркуші стоїть ім'я. Замовлення каже своє — а журнал про нього не
   * знає, бо номер приїхав із 1С.
   *
   * Тому зайнятим вважаємо номер, якщо так вважає бодай одне з трьох.
   * Зайвий пропущений номер коштує дірки в нумерації; виданий двічі —
   * двох ящиків з одним числом на складі.
   */
  const [{ data: orders }, { data: journal }] = await Promise.all([
    service.from('orders')
      .select('manual_number')
      .eq('delivery_date', date)
      .not('manual_number', 'is', null)
      .neq('status', 'Скасовано'),
    service.from('order_numbers')
      .select('number')
      .eq('delivery_date', date)
      .is('released_at', null),
  ])

  return new Set([
    ...(orders ?? []).map(o => Number(o.manual_number)),
    ...(journal ?? []).map(r => Number(r.number)),
  ])
}

/**
 * Найменший вільний номер у прочитаному аркуші.
 *
 * Рядок 1 — заголовки. Номер вважається вільним, коли навпроти нього немає
 * імені й коли його не тримає жодне наше замовлення на цю дату.
 *
 * Колір комірки до уваги не береться: червоним там позначають щось своє,
 * але ім'я в такому рядку стоїть, тобто номер зайнятий.
 */
function firstFree(
  rows: string[][],
  taken: Set<number>,
): { row: number; number: number } | null {
  let best: { row: number; number: number } | null = null

  for (let i = 1; i < rows.length; i++) {
    const n = Number((rows[i]?.[0] ?? '').toString().trim())
    const name = (rows[i]?.[1] ?? '').toString().trim()
    if (!Number.isFinite(n) || n <= 0 || name || taken.has(n)) continue
    if (!best || n < best.number) best = { row: i + 1, number: n }
  }

  return best
}

/**
 * Наступний номер за журналом — і запис імені навпроти нього.
 *
 * Береться **найменший вільний** номер, хоч би де він стояв. Раніше ми
 * шукали перший порожній рядок після останнього заповненого, і це давало
 * дірки: щойно замовлення переносили на інший день, його рядок звільнявся,
 * а нумерація йшла далі — на аркуші стояли 62, 63 порожні, а новому
 * замовленню видавався 68. Номер — це номер ящика, і діри в ньому
 * означають ящики, які ніхто не взяв.
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
  orderId: string | null = null,
): Promise<ReservedNumber> {
  /*
   * Таблиця не відповіла — видаємо номер за власним журналом.
   *
   * Він веде ті самі правила, тож номер виходить той самий, який дала б
   * таблиця. Позначаємо його «не з журналу», бо в аркуші складу його поки
   * немає, і це треба звести руками.
   */
  const fallback = async (note: string): Promise<ReservedNumber> => {
    const own = await nextFreeNumber(service, date)
    const number = own ?? await nextManualNumber(service, date)
    if (own != null) await noteTaken(service, date, own, customerName, orderId)
    return { number, source: 'local', note }
  }

  if (!sheetsConfigured()) {
    return fallback('Доступ до Google-таблиці не налаштовано')
  }

  const spreadsheetId = await registerFor(service, date)
  if (!spreadsheetId) {
    return fallback(`Таблицю на ${date.slice(0, 7)} не вказано`)
  }

  const tab = tabNameFor(date)
  const taken = await takenNumbers(service, date)

  for (let attempt = 0; attempt < 8; attempt++) {
    const rows = await readRange(spreadsheetId, `'${tab}'!A1:B300`)
    if (!rows) return fallback('Таблиця не відповіла')

    const target = firstFree(rows, taken)
    if (!target) {
      return fallback(`У вкладці ${tab} не лишилось вільних номерів`)
    }

    const { row: targetRow, number } = target
    const note = null

    // Перечитуємо саме цю комірку — раптом її щойно зайняли
    const fresh = await readRange(spreadsheetId, `'${tab}'!B${targetRow}`)
    if (fresh?.[0]?.[0]?.toString().trim()) continue

    /*
     * Журнал — перед аркушем.
     *
     * Він відмовить, якщо номер уже за кимось, і тоді в аркуш писати не
     * можна: інакше в таблиці з'явиться друге ім'я навпроти того самого
     * числа, і склад не розрізнить ящики. Відмова — привід узяти
     * наступний вільний, а не привід здатися.
     */
    const noted = await noteTaken(service, date, number, customerName, orderId)
    if (!noted) {
      taken.add(number)
      continue
    }

    const written = await writeCell(spreadsheetId, `'${tab}'!B${targetRow}`, customerName)
    if (!written) {
      await freeNumber(service, { number, date, reason: 'не вдалося записати в таблицю' })
      return fallback('Не вдалося записати в таблицю')
    }

    return { number, source: 'sheet', note }
  }

  return fallback('Номер зайняли під час запису — спробуйте ще раз')
}

/** «2026-10-23» → «23.10»: так дату пишуть у самому аркуші */
const shortDate = (date: string) => {
  const [, m, d] = date.split('-')
  return `${d}.${m}`
}

/**
 * Номер, з якого замовлення поїхало, лишається зайнятим.
 *
 * Перенесення — не скасування. Ящика з цим номером того дня справді не
 * буде, але віддавати число наступному замовленню не можна: склад,
 * комірник і кур'єр уже говорять про «четвертий», у дзвінках і в чаті
 * він названий, і поява другого «четвертого» того самого дня плутає
 * саме там, де плутати найдорожче.
 *
 * Тому рядок не звільняємо, а переписуємо: замість імені — куди
 * замовлення поїхало. Для таблиці комірка лишається непорожньою, отже
 * зайнятою; для журналу рядок лишається взятим; а для людини видно, що
 * сталось, замість мовчазної дірки.
 */
export const MOVED_MARK = 'перенесено на '

export async function blockMovedNumber(
  service: Service,
  { number, date, toDate, orderId = null }: {
    number: number; date: string; toDate: string; orderId?: string | null
  },
): Promise<boolean> {
  const mark = `${MOVED_MARK}${shortDate(toDate)}`

  /*
   * Рядок лишається за тим замовленням, яке поїхало.
   *
   * Без цього він виглядає як покинутий резерв — зайнято, а ким,
   * невідомо, — і прибирання, яке шукає саме такі рядки, повертало його
   * в обіг. Два номери так і звільнились того ж дня, хоч мали лишатись
   * закритими до вечора.
   */
  await takeNumber(service, { date, number, orderId, customerName: mark })

  if (!sheetsConfigured()) return false

  const spreadsheetId = await registerFor(service, date)
  if (!spreadsheetId) return false

  const tab = tabNameFor(date)
  const rows = await readRange(spreadsheetId, `'${tab}'!A1:B300`)
  if (!rows) return false

  for (let i = 1; i < rows.length; i++) {
    if (Number((rows[i]?.[0] ?? '').toString().trim()) === number) {
      return await writeCell(spreadsheetId, `'${tab}'!B${i + 1}`, mark)
    }
  }
  return false
}

/**
 * Переносить номер замовлення з одного дня на інший.
 *
 * Замовлення переносять цілком — разом із номером, під яким його знають на
 * складі й у розмові. Тож у журналі воно має зникнути з учорашнього аркуша
 * й з'явитись на завтрашньому під тим самим числом.
 *
 * Якщо на новий день це число вже зайняте, замовлення все одно переїжджає —
 * але під найменшим вільним номером того дня. Чуже замовлення в журналі ми
 * не переписуємо, а лишати замовлення взагалі без рядка на новому дні гірше,
 * ніж змінити йому число: ящика з таким номером просто не буде.
 *
 * Повертаємо той номер, під яким замовлення врешті стало, — викликач має
 * записати його в себе, інакше Мерчант і склад говоритимуть різними числами.
 */
export async function moveNumber(
  service: Service,
  { number, fromDate, toDate, customerName, orderId = null }: {
    number: number
    fromDate: string
    toDate: string
    customerName: string
    /** Замовлення, що переїжджає — за ним лишається закритий рядок */
    orderId?: string | null
  },
): Promise<{ ok: boolean; number: number; note: string | null }> {
  const same = { ok: false, number }
  if (!sheetsConfigured()) return { ...same, note: 'Журнал недоступний' }

  const [fromSheet, toSheet] = await Promise.all([
    registerFor(service, fromDate),
    registerFor(service, toDate),
  ])
  if (!fromSheet || !toSheet) return { ...same, note: 'Таблицю на ці дати не вказано' }

  const rowOf = (rows: string[][], n: number) => {
    for (let i = 1; i < rows.length; i++) {
      if (Number((rows[i]?.[0] ?? '').toString().trim()) === n) {
        return { row: i + 1, name: (rows[i]?.[1] ?? '').toString().trim() }
      }
    }
    return null
  }

  const toRows = await readRange(toSheet, `'${tabNameFor(toDate)}'!A1:B300`)
  if (!toRows) return { ...same, note: `Вкладка ${tabNameFor(toDate)} не відповіла` }

  const wanted = rowOf(toRows, number)
  let target = wanted && !wanted.name ? { row: wanted.row, number } : null
  let note: string | null = null

  if (!target) {
    // Номер зайнятий або такого рядка немає — шукаємо найменший вільний,
    // пропускаючи ті, що вже тримають наші ж замовлення того дня
    const free = firstFree(toRows, await takenNumbers(service, toDate))
    if (!free) {
      return { ...same, note: `У вкладці ${tabNameFor(toDate)} не лишилось вільних номерів` }
    }
    target = free
    note = wanted?.name
      ? `Номер ${number} на ${tabNameFor(toDate)} зайнятий — «${wanted.name}», дали ${free.number}`
      : `Номер ${number} на ${tabNameFor(toDate)} недоступний — дали ${free.number}`
  }

  const written = await writeCell(
    toSheet, `'${tabNameFor(toDate)}'!B${target.row}`, customerName,
  )
  if (!written) return { ...same, note: 'Не вдалося записати в журнал' }

  await noteTaken(service, toDate, target.number, customerName, orderId)

  /*
   * Старий рядок позначаємо після запису нового.
   *
   * Якщо щось піде не так, замовлення лишиться видимим бодай в одному
   * дні. І позначаємо, а не звільняємо: число, під яким замовлення вже
   * називали, того дня більше нікому не належить.
   */
  await blockMovedNumber(service, { number, date: fromDate, toDate, orderId })

  return { ok: true, number: target.number, note }
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

/**
 * Звільняє рядок журналу — коли замовлення того дня більше не буде.
 *
 * Стирається лише ім'я, а не номер: номер належить аркушу, і рядок має
 * лишитись вільним для наступного замовлення, а не зникнути.
 */
export async function releaseNumber(
  service: Service,
  { number, date, reason = 'рядок звільнено' }: {
    number: number; date: string; reason?: string
  },
): Promise<boolean> {
  /*
   * Свій журнал звільняємо завжди.
   *
   * Раніше це залежало від того, чи вдалося стерти ім'я в Google-таблиці:
   * таблиця мовчить — і номер лишається зайнятим у нас, хоч замовлення
   * вже немає. Дві причини в одному «не вийшло» розрізнити було нічим.
   *
   * Тепер наш запис не залежить від чужого сервісу, а невдача з таблицею
   * видно окремо — її повертаємо назовні.
   */
  await freeNumber(service, { number, date, reason })

  if (!sheetsConfigured()) return false

  const spreadsheetId = await registerFor(service, date)
  if (!spreadsheetId) return false

  const tab = tabNameFor(date)
  const rows = await readRange(spreadsheetId, `'${tab}'!A1:B300`)
  if (!rows) return false

  for (let i = 1; i < rows.length; i++) {
    if (Number((rows[i]?.[0] ?? '').toString().trim()) === number) {
      return await writeCell(spreadsheetId, `'${tab}'!B${i + 1}`, '')
    }
  }
  return false
}

/**
 * Прибирання покинутих резервів.
 *
 * Номер беруть до того, як замовлення існує: спершу треба знати число,
 * щоб вписати його в угоду й на бланк. Якщо створення не доходить до
 * кінця, рядок лишається зайнятим ніким — ні замовлення, ні ящика, а
 * число з обігу випало. У таблиці при цьому стоїть ім'я людини, якій
 * нічого не везуть.
 *
 * Кожна така невдача тепер прибирає за собою сама, але мережа рветься
 * й посеред прибирання. Тому раз на годину проходимо ще й слідом: якщо
 * рядок зайнятий без замовлення довше, ніж триває оформлення, і на це
 * число немає живого замовлення — повертаємо його в обіг.
 */
export async function sweepStaleHolds(
  service: Service,
  { minutes = 30 }: { minutes?: number } = {},
): Promise<{ looked: number; freed: number }> {
  const result = { looked: 0, freed: 0 }

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Kyiv' })
  const edge = new Date(Date.now() - minutes * 60_000).toISOString()

  const { data } = await service
    .from('order_numbers')
    .select('delivery_date, number, customer_name')
    .is('released_at', null)
    .is('order_id', null)
    .lt('taken_at', edge)
    .gte('delivery_date', today)
    /*
     * Перенесене не чіпаємо.
     *
     * «Перенесено на 23.10» — це не покинутий резерв, а навмисне
     * закритий номер: ящика з ним того дня не буде, але й віддавати
     * його нікому не можна, бо про це число вже говорили. Воно тримає
     * рядок свідомо, і прибирання тут не для нього.
     */
    .not('customer_name', 'ilike', `${MOVED_MARK}%`)

  const holds = (data ?? []) as { delivery_date: string; number: number }[]
  result.looked = holds.length

  for (const hold of holds) {
    /*
     * Живе замовлення на це число — не чіпаємо.
     *
     * Рядок без замовлення в журналі не завжди означає покинутий резерв:
     * номер міг приїхати з 1С, а зв'язок із замовленням ще не склався.
     */
    const { count } = await service
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('delivery_date', hold.delivery_date)
      .eq('manual_number', hold.number)
      .neq('status', 'Скасовано')

    if (count) continue

    await releaseNumber(service, {
      number: hold.number,
      date: hold.delivery_date,
      reason: 'резерв без замовлення',
    })
    result.freed++
  }

  return result
}

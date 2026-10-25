/**
 * Журнал номерів ящиків — усередині Мерчанта.
 *
 * Номер живе в Google-таблиці, бо за нею працює склад. Але таблиця —
 * чужа територія: вона мовчки не відповідає, її правлять руками, і
 * дізнатись, чому номер саме такий, з неї не можна.
 *
 * Тому той самий журнал ведеться й тут, за тими самими правилами:
 * найменший вільний номер на день, ім'я навпроти числа, звільнений рядок
 * повертається в обіг. Різниця в тому, що тут видно історію: хто взяв
 * номер, коли, за яким замовленням і чому його звільнили.
 *
 * Таблиця лишається головною для складу — ми пишемо в обидва місця, і
 * розбіжність між ними видно одразу, замість того щоб здогадуватись.
 */
import { createServiceClient } from '@/lib/supabase/service'

type Service = ReturnType<typeof createServiceClient>

/** Скільки номерів має день. Стільки ж рядків і в аркуші таблиці. */
export const NUMBERS_PER_DAY = 300

export interface RegisterRow {
  number: number
  order_id: string | null
  customer_name: string | null
  taken_at: string
  released_at: string | null
  released_reason: string | null
}

/**
 * Записує, що номер зайнято.
 *
 * Повертає false, якщо його вже тримає хтось інший: журнал тут не
 * вирішує суперечку, а показує, що вона була.
 */
export async function takeNumber(
  service: Service,
  { date, number, orderId, customerName }: {
    date: string
    number: number
    orderId: string | null
    customerName: string | null
  },
): Promise<boolean> {
  /*
   * Чужий рядок не перебиваємо.
   *
   * Запис ішов через upsert, і той, хто брав номер другим, мовчки ставав
   * на місце першого: у журналі лишалось одне ім'я, хоч ящиків двоє. Так
   * «Горинь Юлія» зникла з сьомого номера, а на складі їх стало два.
   *
   * Тепер зайнятий рядок — це відмова, а не перезапис. Хто саме його
   * тримає, вирішує журнал, а не черговість запису.
   */
  const { data: held } = await service.from('order_numbers')
    .select('order_id, taken_at')
    .eq('delivery_date', date).eq('number', number).is('released_at', null)
    .maybeSingle()

  if (held && held.order_id && held.order_id !== orderId) return false

  /*
   * Щойно взятий нічийний рядок — теж чужий.
   *
   * Номер беруть раніше, ніж з'являється замовлення: телефонне ще
   * заповнюють, перенесене ще не створило угоду. У ці секунди рядок
   * стоїть без `order_id`, і перевірка вище його пропускала — другий
   * прохід спокійно ставав на місце першого. Саме так два замовлення
   * Безпалюк Ольги опинились під сімнадцятим.
   *
   * Тож свіжий нічийний рядок вважаємо зайнятим. Той, хто на нього
   * натрапив, візьме наступний вільний — це дешевше за ящик-двійник.
   * Давній нічийний — то слід обірваної спроби, його прибирає
   * `sweepStaleHolds`, і він лишається доступним.
   */
  const FRESH_MS = 2 * 60_000
  if (held && !held.order_id
    && Date.now() - new Date(held.taken_at as string).getTime() < FRESH_MS) {
    return false
  }

  const { error } = await service.from('order_numbers').upsert({
    delivery_date: date,
    number,
    order_id: orderId,
    customer_name: customerName,
    taken_at: new Date().toISOString(),
    released_at: null,
    released_reason: null,
  }, { onConflict: 'delivery_date,number' })

  return !error
}

/** Звільняє номер, лишаючи слід, чому саме */
export async function freeNumber(
  service: Service,
  { date, number, reason }: { date: string; number: number; reason: string },
): Promise<void> {
  await service.from('order_numbers')
    .update({ released_at: new Date().toISOString(), released_reason: reason })
    .eq('delivery_date', date).eq('number', number).is('released_at', null)
}

/**
 * Записує номер, який прийшов не від нас.
 *
 * Номер ящика ставлять і в 1С — і тоді він приїжджає до нас уже на
 * замовленні, повз журнал. Поки ми такі номери не записували, журнал
 * вважав ящик вільним і міг видати його вдруге: саме так два різні
 * клієнти одного дня опинялись під одним числом.
 *
 * Чужий запис не перебиваємо: якщо рядок уже за кимось, це розбіжність,
 * і вирішувати її має людина, а не тихий перезапис.
 */
export async function noteExternalNumber(
  service: Service,
  { date, number, orderId, customerName }: {
    date: string
    number: number
    orderId: string | null
    customerName: string | null
  },
): Promise<void> {
  const { data: held } = await service.from('order_numbers')
    .select('order_id')
    .eq('delivery_date', date).eq('number', number).is('released_at', null)
    .maybeSingle()

  if (held && held.order_id !== orderId) return

  await takeNumber(service, { date, number, orderId, customerName })
}

/**
 * Найменший вільний номер дня — за нашим власним журналом.
 *
 * Потрібен тоді, коли таблиця не відповіла: краще видати номер за своїм
 * записом, ніж не видати зовсім. Зайняті номери беремо і з журналу, і з
 * самих замовлень — на випадок, якщо журнал відстав.
 *
 * Рахуємо всі номери дня, хоч би звідки вони взялись. Раніше номери з
 * Бітрікса до уваги не бралось — мовляв, там своя нумерація; наслідком
 * було те, що журнал спокійно видавав число, яке 1С уже зайняла, і на
 * складі два ящики мали однаковий номер.
 */
export async function nextFreeNumber(service: Service, date: string): Promise<number | null> {
  const [{ data: held }, { data: orders }] = await Promise.all([
    service.from('order_numbers')
      .select('number').eq('delivery_date', date).is('released_at', null),
    service.from('orders')
      .select('manual_number')
      .eq('delivery_date', date)
      .not('manual_number', 'is', null)
      .neq('status', 'Скасовано'),
  ])

  const taken = new Set<number>([
    ...(held ?? []).map(r => Number(r.number)),
    ...(orders ?? []).map(o => Number(o.manual_number)),
  ])

  for (let n = 1; n <= NUMBERS_PER_DAY; n++) if (!taken.has(n)) return n
  return null
}

/** Увесь день — для сторінки журналу */
export async function registerFor(service: Service, date: string): Promise<RegisterRow[]> {
  const { data } = await service
    .from('order_numbers')
    .select('number, order_id, customer_name, taken_at, released_at, released_reason')
    .eq('delivery_date', date)
    .order('number')

  return (data ?? []) as unknown as RegisterRow[]
}

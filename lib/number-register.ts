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
 * Найменший вільний номер дня — за нашим власним журналом.
 *
 * Потрібен тоді, коли таблиця не відповіла: краще видати номер за своїм
 * записом, ніж не видати зовсім. Зайняті номери беремо і з журналу, і з
 * самих замовлень — на випадок, якщо журнал відстав.
 */
export async function nextFreeNumber(service: Service, date: string): Promise<number | null> {
  const [{ data: held }, { data: orders }] = await Promise.all([
    service.from('order_numbers')
      .select('number').eq('delivery_date', date).is('released_at', null),
    service.from('orders')
      .select('manual_number')
      .eq('delivery_date', date)
      .not('manual_number', 'is', null)
      .not('number_source', 'is', null),
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

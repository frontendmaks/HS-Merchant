/**
 * Як шукати клієнта по набраному.
 *
 * Цифри й літери — різні пошуки: номер шукається серед номерів, ім'я серед
 * імен. Тому вибір колонки тут один на всі місця, де клієнта шукають, щоб
 * форма замовлення й вкладка «Клієнти» відповідали однаково.
 */
export interface CustomerQuery {
  column: 'phone_search' | 'text_search'
  needle: string
}

export function customerQuery(raw: string): CustomerQuery | null {
  const q = raw.trim()
  if (q.length < 2) return null

  // Номери лежать як «380677361256», а набирають їх і з нуля, і з плюсом —
  // тож ведучі нулі відкидаємо, щоб «067…» знайшло «38067…»
  const digits = q.replace(/\D/g, '').replace(/^0+/, '')

  // Триграмний індекс працює від трьох символів; коротше — хай шукає текстом
  if (digits.length >= 3) return { column: 'phone_search', needle: digits }

  return { column: 'text_search', needle: q.toLowerCase().replace(/[%_]/g, ' ') }
}

/**
 * Телефон як ідентифікатор клієнта.
 *
 * Один і той самий номер записують «+380633889620», «380633889620»,
 * «0633889620» і з пробілами всередині. Порівнювати їх як текст — означає
 * бачити чотирьох різних клієнтів, тож звіряємо за останніми дев'ятьма
 * цифрами: це номер без коду країни й без нуля, і він однаковий у всіх
 * написаннях.
 */
export function phoneKey(phone: string | null | undefined): string {
  const digits = (phone ?? '').replace(/\D/g, '')
  return digits.length >= 9 ? digits.slice(-9) : ''
}

/** Чи схожий набраний рядок на повний номер телефону. */
export const isPhoneComplete = (phone: string): boolean =>
  phoneKey(phone).length === 9

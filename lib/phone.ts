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

/**
 * Ім'я, телефон і пошта, злиті в один рядок.
 *
 * Коли до угоди не прив'язаний контакт, Бітрікс кладе все, що знає про
 * покупця, в одне текстове поле: «Наталія Садова, +38 (067) 763 62 67,
 * natalaromanak@gmail.com». Телефон там є — його просто ніхто не дістав,
 * і через це замовлення лишалось без телефону зовсім.
 */
export function splitPersona(raw: string | null | undefined): {
  name: string | null
  phone: string | null
} {
  const text = (raw ?? '').trim()
  if (!text) return { name: null, phone: null }

  // Послідовність із цифр і розділових знаків, у якій дев'ять значущих цифр
  const found = [...text.matchAll(/\+?[\d][\d\s\-()]{8,}/g)]
    .map(m => m[0])
    .find(candidate => phoneKey(candidate).length === 9)

  const name = text
    .replace(found ?? '', ' ')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, ' ')
    .replace(/[\s,;]+/g, ' ')
    .trim()

  return {
    name: name || null,
    phone: found ? found.replace(/[\s()-]/g, '') : null,
  }
}

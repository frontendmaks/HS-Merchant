/**
 * Виклики до Бітрікса.
 *
 * Доступ — вхідний вебхук: посилання з кодом усередині, яке само по собі є
 * ключем. Воно лежить у змінній оточення й нікуди не потрапляє — ні в логи,
 * ні у відповіді: помилку від Бітрікса ми показуємо, адресу запиту ні.
 */

export const bitrixConfigured = () => !!process.env.BITRIX_WEBHOOK_URL

/**
 * Бітрікс розуміє вкладені параметри у вигляді `fields[TITLE]=…`.
 *
 * JSON він теж приймає, але не в усіх версіях коробки — а форма працює
 * скрізь однаково, тож розкладаємо об'єкт самі.
 */
function toForm(value: unknown, prefix: string, out: string[]): void {
  if (value === undefined || value === null) return

  if (Array.isArray(value)) {
    value.forEach((v, i) => toForm(v, `${prefix}[${i}]`, out))
    return
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      toForm(v, `${prefix}[${k}]`, out)
    }
    return
  }
  out.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(value))}`)
}

export class BitrixError extends Error {
  constructor(public method: string, public code: string, description: string) {
    super(`${method}: ${description || code}`)
  }
}

/**
 * Торговий каталог ходить іншим вебхуком.
 *
 * Ціни живуть у модулі «Торговий каталог», і він перевіряє не дозволи
 * застосунку, а роль користувача, від якого створено вебхук. Наш працює
 * від звичайного співробітника, і всі `catalog.*` для нього закриті.
 *
 * Тому для каталогу є окремий вебхук — від користувача з правами на
 * читання цін. Решта викликів лишається на своєму: чим менше прав у
 * ключа, яким робиться повсякденна робота, тим менша ціна його втрати.
 */
export const catalogConfigured = () => !!process.env.BITRIX_CATALOG_WEBHOOK_URL

export async function bitrixCatalog<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  return call<T>(method, params, process.env.BITRIX_CATALOG_WEBHOOK_URL, 'BITRIX_CATALOG_WEBHOOK_URL')
}

export async function bitrix<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  return call<T>(method, params, process.env.BITRIX_WEBHOOK_URL, 'BITRIX_WEBHOOK_URL')
}

async function call<T>(
  method: string,
  params: Record<string, unknown>,
  hook: string | undefined,
  which: string,
): Promise<T> {
  if (!hook) throw new Error(`${which} не налаштовано`)

  const body: string[] = []
  for (const [k, v] of Object.entries(params)) toForm(v, k, body)

  const res = await fetch(`${hook.replace(/\/$/, '')}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.join('&'),
    signal: AbortSignal.timeout(20_000),
  })

  const data = await res.json().catch(() => null) as
    { result?: T; error?: string; error_description?: string } | null

  if (!data) throw new BitrixError(method, 'bad_response', `відповідь не розібралась (HTTP ${res.status})`)
  if (data.error) throw new BitrixError(method, data.error, data.error_description ?? '')

  return data.result as T
}

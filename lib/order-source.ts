/**
 * Звідки прийшло замовлення.
 *
 * Замовлення лежать в одній таблиці, але опрацьовують їх по-різному:
 * маркетплейсне має ТТН, комісію й свій статус на боці майданчика, замовлення
 * з сайту — період доставки, склад і бланк для комірника. Тому вкладка
 * «Замовлення» показує все разом, а працюють у двох окремих.
 */
export const MARKETPLACE_PLATFORMS = ['maudau', 'rozetka'] as const

/** Сайт і телефон — один потік: обидва веде оператор сам, без майданчика. */
export const SITE_PLATFORMS = ['manual', 'site'] as const

export type OrderSource = 'marketplace' | 'site'

export function orderSource(platform: string | null): OrderSource {
  return (MARKETPLACE_PLATFORMS as readonly string[]).includes(platform ?? '')
    ? 'marketplace'
    : 'site'
}

/** Куди йти, щоб це замовлення опрацювати. */
export function processingHref(platform: string | null): string {
  return orderSource(platform) === 'marketplace' ? '/orders/marketplaces' : '/orders/site'
}

export const PLATFORM_LABEL: Record<string, string> = {
  maudau: 'MauDau',
  rozetka: 'Rozetka',
  manual: 'Телефон',
  site: 'Сайт',
}

export const platformLabel = (platform: string | null) =>
  PLATFORM_LABEL[platform ?? ''] ?? (platform || '—')

/**
 * Літера майданчика в номері замовлення.
 *
 * Маркетплейсні замовлення мають власну чергу номерів: на складі їх
 * називають «М дванадцять», і плутати це число з номером ящика
 * кур'єрської доставки не можна — то дві різні черги на один день.
 * Літера й розрізняє їх з одного погляду.
 */
export const PLATFORM_PREFIX: Record<string, string> = {
  maudau: 'M',
  rozetka: 'R',
}

/** «maudau» + 12 → «M12». Без номера — порожньо, щоб нічого не вигадувати. */
export function marketNumberLabel(
  platform: string | null,
  number: number | null | undefined,
): string | null {
  if (number == null) return null
  const prefix = PLATFORM_PREFIX[platform ?? ''] ?? (platform ?? '?').charAt(0).toUpperCase()
  return `${prefix}${number}`
}

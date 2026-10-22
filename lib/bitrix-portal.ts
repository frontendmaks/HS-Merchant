/**
 * Адреса самого порталу — без ключа.
 *
 * Посилання на угоду потрібне там, де на неї дивиться людина: побачив
 * замовлення в Мерчанті — відкрив угоду, не шукаючи її в CRM руками. А
 * шукати там непросто: угода без контакту зветься «Угода #200596», і ні
 * прізвище, ні телефон її не знаходять.
 *
 * Вебхук сам по собі є ключем, тож від нього лишаємо тільки походження —
 * доменне ім'я порталу, яке й так видно кожному, хто в ньому працює.
 */
export function bitrixPortal(): string | null {
  const hook = process.env.BITRIX_WEBHOOK_URL
  if (!hook) return null
  try {
    return new URL(hook).origin
  } catch {
    return null
  }
}

export function dealUrl(id: number | null | undefined): string | null {
  const portal = bitrixPortal()
  return portal && id ? `${portal}/crm/deal/details/${id}/` : null
}

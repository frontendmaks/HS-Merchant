/**
 * Правки картки клієнта — і їхній шлях у Бітрікс.
 *
 * Картка збирається із замовлень і перезбирається щоночі. Усе, що вписали
 * руками, наступний перерахунок затер би, тож правки живуть окремими
 * полями й накладаються зверху: зібране лишається зібраним, а людина має
 * останнє слово.
 *
 * Прибрану адресу доводиться пам'ятати окремо — вона й далі стоїть у
 * старих замовленнях, і без цього списку перерахунок повертав би її
 * щоночі назад.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { bitrix } from '@/lib/bitrix'

type Service = ReturnType<typeof createServiceClient>

export interface CustomerEdits {
  name: string | null
  name_override: string | null
  addresses: string[] | null
  addresses_added: string[] | null
  addresses_hidden: string[] | null
  bitrix_contact_id: number | null
  phone: string | null
  phones: string[] | null
}

/**
 * Адреси, які варто показувати.
 *
 * Зібрані із замовлень плюс дописані руками, мінус прибрані. Порівнюємо
 * без зайвих пробілів і регістру: та сама адреса приходить із трьох
 * джерел трьома написаннями, і прибрати її мали б один раз, а не тричі.
 */
const key = (a: string) => a.trim().toLowerCase().replace(/\s+/g, ' ')

export function effectiveAddresses(c: CustomerEdits): string[] {
  const hidden = new Set((c.addresses_hidden ?? []).map(key))
  const out = new Map<string, string>()

  for (const a of [...(c.addresses ?? []), ...(c.addresses_added ?? [])]) {
    const value = (a ?? '').trim()
    if (!value || hidden.has(key(value))) continue
    out.set(key(value), value)
  }

  return [...out.values()]
}

/** ПІБ, вписане людиною, головніше за зібране */
export const effectiveName = (c: CustomerEdits): string | null =>
  (c.name_override ?? '').trim() || c.name

/**
 * Ім'я для CRM — прізвище окремо від імені.
 *
 * У Бітріксі це два поля, і в наших контактах прізвище стоїть першим:
 * «Коцупир Максим». Решта слів лишається в імені — по батькові трапляється
 * рідко, а другого прізвища не буває.
 */
export function splitName(full: string): { last: string; first: string } {
  const words = full.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return { last: '', first: '' }
  if (words.length === 1) return { last: words[0], first: '' }
  return { last: words[0], first: words.slice(1).join(' ') }
}

/**
 * Переносить картку в контакт Бітрікса.
 *
 * Адреси там лежать у власному полі, яке приймає кілька значень; перша з
 * них іде ще й у головну, бо саме її показує картка контакту. Якщо
 * контакту ще немає, нічого не робимо: заводити його з цього екрана —
 * окрема розмова, а мовчки створювати другий контакт на ту саму людину
 * гірше, ніж не створити жодного.
 */
export async function pushCustomerToBitrix(
  service: Service,
  phoneKey: string,
): Promise<{ ok: true; contact: number } | { error: string }> {
  const { data } = await service
    .from('customers')
    .select('name, name_override, addresses, addresses_added, addresses_hidden, bitrix_contact_id, phone, phones')
    .eq('phone_key', phoneKey)
    .maybeSingle()

  if (!data) return { error: 'Клієнта не знайдено' }

  const customer = data as unknown as CustomerEdits
  if (!customer.bitrix_contact_id) return { error: 'У клієнта немає контакту в Бітріксі' }

  const addresses = effectiveAddresses(customer)
  const name = effectiveName(customer)
  const fields: Record<string, unknown> = {
    UF_AD_ADDRESS: addresses,
    UF_MAIN_ADDRESS: addresses[0] ?? '',
  }

  if (name) {
    const { last, first } = splitName(name)
    fields.LAST_NAME = last
    fields.NAME = first
  }

  try {
    await bitrix('crm.contact.update', { id: customer.bitrix_contact_id, fields })
    return { ok: true, contact: customer.bitrix_contact_id }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

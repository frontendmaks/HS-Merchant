import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor } from '@/lib/order-events'
import { phoneKey } from '@/lib/phone'
import { bitrix, bitrixConfigured } from '@/lib/bitrix'

/**
 * GET /api/orders/manual/customers/<ключ>
 *
 * Усе, що знаємо про клієнта в момент вибору: адреси передусім.
 *
 * Більшість клієнтів прийшла з контактів CRM, а там адреси немає — вона
 * лежить в угодах. Тому для тих, у кого адреси ще не бачили, питаємо
 * Бітрікс: оператор вибрав клієнта й чекає, що адреса підставиться сама.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  if (!await currentActor()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { key } = await params
  const digits = phoneKey(key)
  if (!digits) return NextResponse.json({ error: 'Невірний номер' }, { status: 400 })

  const service = createServiceClient()
  const { data: customer } = await service
    .from('customers')
    .select('phone_key, phone, name, names, phones, addresses, bitrix_contact_id')
    .eq('phone_key', digits).maybeSingle()

  const addresses = [...((customer?.addresses as string[] | null) ?? [])]

  // Адреси з угод — там, де їх ще не було. Беремо кілька останніх: клієнт
  // міг переїхати, і вибір має лишитись за оператором
  if (!addresses.length && customer?.bitrix_contact_id && bitrixConfigured()) {
    try {
      const deals = await bitrix<{ UF_CRM_1606294264905: string | null }[]>('crm.deal.list', {
        filter: { CONTACT_ID: customer.bitrix_contact_id },
        select: ['UF_CRM_1606294264905'],
        order: { ID: 'DESC' },
      })
      for (const d of (deals ?? []).slice(0, 10)) {
        const a = d.UF_CRM_1606294264905?.trim()
        if (a && !addresses.includes(a)) addresses.push(a)
      }

      // Знайдене лишаємо в базі: вдруге питати Бітрікс про того самого
      // клієнта вже не доведеться
      if (addresses.length) {
        await service.from('customers')
          .update({ addresses, updated_at: new Date().toISOString() })
          .eq('phone_key', digits)
      }
    } catch {
      // Без адреси форма працює — оператор впише її сам
    }
  }

  return NextResponse.json({
    key: digits,
    phone: customer?.phone ?? null,
    names: (customer?.names as string[] | null) ?? [],
    phones: (customer?.phones as string[] | null) ?? [],
    addresses,
  })
}

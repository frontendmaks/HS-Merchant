import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor } from '@/lib/order-events'
import { phoneKey } from '@/lib/phone'
import {
  effectiveAddresses, pushCustomerToBitrix, type CustomerEdits,
} from '@/lib/customer-edit'
import { getCurrentRole, canAccess } from '@/lib/getRole'


/**
 * GET /api/customers/<ключ>
 *
 * Картка клієнта: його замовлення й те, що він зазвичай бере. Тягнемо на
 * вимогу, коли рядок розгорнули — у списку з сотень клієнтів це дані, які
 * майже нікому не потрібні, поки їх не спитали.
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

  const [{ data: orders }, { data: products }] = await Promise.all([
    service.from('orders')
      .select('id, external_id, manual_number, platform, order_date, status, total, address, warehouse, delivery_date, delivery_slot, review:order_reviews(rating, comment)')
      .filter('customer_phone', 'like', `%${digits}`)
      .order('order_date', { ascending: false })
      .limit(50),
    service.from('customer_products')
      .select('title, qty, unit, times, last_order')
      .eq('phone_key', digits)
      .order('times', { ascending: false })
      .limit(15),
  ])

  return NextResponse.json({ orders: orders ?? [], products: products ?? [] })
}

/**
 * PATCH /api/customers/<phone_key> — правка картки клієнта.
 *
 * Міняти можна ПІБ і перелік адрес. Усе, що вписали, одразу їде в контакт
 * Бітрікса: оператор дивиться на картку в Мерчанті, а замовлення складає
 * в CRM — і дві різні адреси в цих двох місцях означають поїздку не туди.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const role = await getCurrentRole()
  const actor = await currentActor()
  if (!actor || !canAccess('customers', role)) {
    return NextResponse.json({ error: 'Немає доступу' }, { status: 403 })
  }

  const { key: phone } = await params
  const body = await req.json().catch(() => null) as {
    name?: string | null
    addAddress?: string
    removeAddress?: string
  } | null

  if (!body) return NextResponse.json({ error: 'Bad request' }, { status: 400 })

  const service = createServiceClient()
  const { data } = await service
    .from('customers')
    .select('name, name_override, addresses, addresses_added, addresses_hidden, bitrix_contact_id, phone, phones')
    .eq('phone_key', phone)
    .maybeSingle()

  if (!data) return NextResponse.json({ error: 'Клієнта не знайдено' }, { status: 404 })

  const customer = data as unknown as CustomerEdits
  const patch: Record<string, unknown> = {
    edited_at: new Date().toISOString(),
    edited_by: actor.name,
  }

  if (body.name !== undefined) {
    // Порожнє поле — не нове ім'я, а відмова від правки: повертаємось до
    // того, що зібралось із замовлень
    patch.name_override = (body.name ?? '').trim() || null
  }

  const add = body.addAddress?.trim()
  if (add) {
    /*
     * Додана адреса перестає бути прихованою.
     *
     * Інакше вписати назад те, що колись прибрали, було б неможливо:
     * список прихованих сильніший, і адреса зникала б одразу після
     * додавання.
     */
    const same = (a: string) => a.trim().toLowerCase().replace(/\s+/g, ' ')
    patch.addresses_hidden = (customer.addresses_hidden ?? [])
      .filter(a => same(a) !== same(add))
    patch.addresses_added = [
      ...new Set([...(customer.addresses_added ?? []), add]),
    ]
  }

  const remove = body.removeAddress?.trim()
  if (remove) {
    const same = (a: string) => a.trim().toLowerCase().replace(/\s+/g, ' ')
    patch.addresses_hidden = [
      ...new Set([...(customer.addresses_hidden ?? []), remove]),
    ]
    // Прибрана адреса не має лишатись серед дописаних — інакше вона
    // двічі боролась би сама з собою
    patch.addresses_added = (customer.addresses_added ?? [])
      .filter(a => same(a) !== same(remove))
  }

  const { error } = await service.from('customers').update(patch).eq('phone_key', phone)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: fresh } = await service
    .from('customers')
    .select('name, name_override, addresses, addresses_added, addresses_hidden, bitrix_contact_id, phone, phones')
    .eq('phone_key', phone)
    .maybeSingle()

  const crm = await pushCustomerToBitrix(service, phone)

  return NextResponse.json({
    ok: true,
    addresses: effectiveAddresses((fresh ?? customer) as unknown as CustomerEdits),
    name: ((fresh as unknown as CustomerEdits)?.name_override ?? '').trim()
      || (fresh as unknown as CustomerEdits)?.name || null,
    crm_error: 'error' in crm ? crm.error : null,
  })
}

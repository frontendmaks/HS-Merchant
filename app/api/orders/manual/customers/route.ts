import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor } from '@/lib/order-events'
import { phoneKey } from '@/lib/phone'

/**
 * GET /api/orders/manual/customers?q=…
 *
 * Клієнт для форми замовлення — з тієї самої бази, що й вкладка «Клієнти».
 * Раніше тут була своя вибірка по замовленнях: вона давала інші відповіді,
 * ніж вкладка, і два списки клієнтів у одній системі починали розходитись.
 */
export async function GET(req: NextRequest) {
  if (!await currentActor()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
  if (q.length < 3) return NextResponse.json({ customers: [] })

  const service = createServiceClient()
  const digits = q.replace(/\D/g, '')

  let query = service.from('customers')
    .select('phone_key, phone, name, names, addresses, orders_count, last_order')

  query = digits.length >= 4
    // Хвіст номера однаковий у всіх написаннях
    ? query.like('phone_key', `%${phoneKey(q) || digits.slice(-9)}%`)
    : query.ilike('name', `%${q.replace(/[%_,()]/g, ' ')}%`)

  const { data } = await query
    .order('last_order', { ascending: false })
    .limit(20)

  const customers = (data ?? []).map(c => ({
    key: c.phone_key,
    phone: c.phone,
    // Найсвіжіше ім'я першим: саме його підставляє форма, а в масиві
    // `names` порядок довільний — там просто всі написання, які траплялись
    names: [...new Set([
      ...(c.name ? [c.name as string] : []),
      ...((c.names as string[] | null) ?? []),
    ])],
    addresses: (c.addresses as string[] | null) ?? [],
    orders: Number(c.orders_count),
    last: c.last_order,
  }))

  return NextResponse.json({ customers })
}

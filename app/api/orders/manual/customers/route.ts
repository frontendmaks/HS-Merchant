import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor } from '@/lib/order-events'

/**
 * GET /api/orders/manual/customers?q=…
 *
 * Клієнт для форми замовлення — з тієї самої бази, що й вкладка «Клієнти».
 *
 * Шукаємо по всьому одразу: імені в будь-якому написанні, будь-якому з
 * телефонів, будь-якій адресі. Оператор не знає, що саме з цього він щойно
 * почув у слухавці, і не має вибирати поле, перш ніж набрати.
 */
export async function GET(req: NextRequest) {
  if (!await currentActor()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const raw = (req.nextUrl.searchParams.get('q') ?? '').trim()
  // Двох символів досить: підказка має з'являтись, поки людина ще набирає,
  // а не після того, як вона дописала й пішла шукати очима
  if (raw.length < 2) return NextResponse.json({ customers: [] })

  const digits = raw.replace(/\D/g, '')
  // «0677…» і «+38067…» — той самий номер, тож нуль попереду відкидаємо:
  // у пошуковому рядку номери лежать у вигляді 380…
  const needle = digits.length >= 3
    ? digits.replace(/^0+/, '')
    : raw.toLowerCase()

  const service = createServiceClient()
  const { data } = await service.from('customers')
    .select('phone_key, phone, name, names, addresses, orders_count, last_order')
    .ilike('search', `%${needle.replace(/[%_]/g, ' ')}%`)
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

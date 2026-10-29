import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor } from '@/lib/order-events'
import { customerQuery } from '@/lib/customer-search'

/**
 * GET /api/orders/manual/customers?q=…
 *
 * Клієнт для форми замовлення — з тієї самої бази, що й вкладка «Клієнти».
 *
 * З `by=phone` шукаємо лише за номером — так питає форма приймання
 * замовлення. Клієнт там упізнається телефоном і нічим іншим: ім'я одне
 * на сотню людей, і набране зі слуху «Коваленко» підставляло картку
 * чужого Коваленка разом із його адресою.
 *
 * Без `by` шукаємо по всьому одразу — імені, телефонах, адресах: так
 * питає вкладка «Клієнти», де шукають людину, а не звіряють номер.
 */
export async function GET(req: NextRequest) {
  if (!await currentActor()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Двох символів досить: підказка має з'являтись, поки людина ще набирає,
  // а не після того, як вона дописала й пішла шукати очима
  const q = customerQuery(
    req.nextUrl.searchParams.get('q') ?? '',
    req.nextUrl.searchParams.get('by') === 'phone',
  )
  if (!q) return NextResponse.json({ customers: [] })

  const service = createServiceClient()
  const { data } = await service.from('customers')
    .select('phone_key, phone, name, names, phones, addresses, orders_count, last_order')
    .like(q.column, `%${q.needle}%`)
    // Хто замовляв нещодавно, той імовірніше й дзвонить
    .order('last_order', { ascending: false, nullsFirst: false })
    .limit(20)

  const customers = (data ?? []).map(c => {
    const phones = (c.phones as string[] | null) ?? []
    /**
     * Показуємо той номер, який збігся.
     *
     * У клієнта їх буває три, а в картці стоїть перший-ліпший — і оператор
     * бачив у списку номери, які не мають нічого спільного з набраним, хоча
     * збіг щоразу був справжній, просто в іншому полі того самого клієнта.
     */
    const matched = q.column === 'phone_search'
      ? phones.find(p => p.replace(/\D/g, '').includes(q.needle))
      : undefined

    return {
    key: c.phone_key,
    phone: matched ?? c.phone,
    phones,
    // Найсвіжіше ім'я першим: саме його підставляє форма, а в масиві
    // `names` порядок довільний — там просто всі написання, які траплялись
    names: [...new Set([
      ...(c.name ? [c.name as string] : []),
      ...((c.names as string[] | null) ?? []),
    ])],
    addresses: (c.addresses as string[] | null) ?? [],
    orders: Number(c.orders_count),
    last: c.last_order,
    }
  })

  return NextResponse.json({ customers })
}

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor } from '@/lib/order-events'

/**
 * GET /api/orders/manual/customers?q=…
 *
 * Клієнти з минулих замовлень.
 *
 * Окремої бази клієнтів поки немає, але вона фактично вже є: кожне замовлення
 * несе ім'я, телефон і адресу. Групуємо за іменем — так один клієнт із трьома
 * номерами приходить одним записом із трьома номерами на вибір, а не трьома
 * однаковими рядками.
 */
export async function GET(req: NextRequest) {
  if (!await currentActor()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
  if (q.length < 2) return NextResponse.json({ customers: [] })

  const safe = q.replace(/[%_,()]/g, ' ').trim()
  const service = createServiceClient()

  const { data } = await service
    .from('orders')
    .select('customer_name, customer_phone, address, branch, order_date')
    .or(`customer_name.ilike.%${safe}%,customer_phone.ilike.%${safe}%`)
    .not('customer_name', 'is', null)
    .order('order_date', { ascending: false })
    .limit(200)

  const byName = new Map<string, {
    name: string; phones: string[]; addresses: string[]; orders: number; last: string | null
  }>()

  for (const o of data ?? []) {
    const name = (o.customer_name as string).trim()
    if (!name) continue
    const entry = byName.get(name) ?? {
      name, phones: [], addresses: [], orders: 0, last: null,
    }
    entry.orders++
    entry.last ??= o.order_date as string

    const phone = (o.customer_phone as string | null)?.trim()
    if (phone && !entry.phones.includes(phone)) entry.phones.push(phone)

    // Відділення теж адреса — просто чужа; для повторного замовлення згодиться
    const place = ((o.address as string | null) || (o.branch as string | null) || '').trim()
    if (place && !entry.addresses.includes(place)) entry.addresses.push(place)

    byName.set(name, entry)
  }

  const customers = [...byName.values()]
    .sort((a, b) => b.orders - a.orders)
    .slice(0, 20)

  return NextResponse.json({ customers })
}

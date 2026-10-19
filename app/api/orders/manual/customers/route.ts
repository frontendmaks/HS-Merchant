import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor } from '@/lib/order-events'
import { phoneKey } from '@/lib/phone'

/**
 * GET /api/orders/manual/customers?q=…
 *
 * Клієнти з минулих замовлень.
 *
 * Окремої бази клієнтів поки немає, але вона фактично вже є: кожне замовлення
 * несе ім'я, телефон і адресу.
 *
 * Збираємо за телефоном, не за іменем. Ім'я в замовленнях пишуть як почули —
 * «Костишин Денис», «Денис К.», «денис костишин», — і за ним один клієнт
 * розпадається на трьох. Телефон той самий у будь-якому записі, і саме його
 * оператор чує першим.
 */
export async function GET(req: NextRequest) {
  if (!await currentActor()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
  if (q.length < 3) return NextResponse.json({ customers: [] })

  const safe = q.replace(/[%_,()]/g, ' ').trim()
  const digits = q.replace(/\D/g, '')
  const service = createServiceClient()

  // Телефон у базі лежить по-різному: «+380…», «380…», «0…». Шукаємо за
  // хвостом набраного — він однаковий у всіх записах
  const tail = digits.length >= 4 ? digits.slice(-9) : ''
  const filters = [`customer_name.ilike.%${safe}%`]
  if (tail) filters.push(`customer_phone.ilike.%${tail}%`)

  const { data } = await service
    .from('orders')
    .select('customer_name, customer_phone, address, branch, order_date')
    .or(filters.join(','))
    .not('customer_phone', 'is', null)
    .order('order_date', { ascending: false })
    .limit(300)

  interface Entry {
    key: string; phone: string; names: string[]; addresses: string[]
    orders: number; last: string | null
  }
  const byPhone = new Map<string, Entry>()

  for (const o of data ?? []) {
    const phone = (o.customer_phone as string | null)?.trim()
    const key = phoneKey(phone)
    if (!key) continue

    const entry = byPhone.get(key) ?? {
      key, phone: phone!, names: [], addresses: [], orders: 0, last: null,
    }
    entry.orders++
    // Замовлення йдуть від найновішого, тож перше й буде останнім за датою
    entry.last ??= o.order_date as string

    const name = (o.customer_name as string | null)?.trim()
    if (name && !entry.names.includes(name)) entry.names.push(name)

    // Відділення теж адреса — просто чужа; для повторного замовлення згодиться
    const place = ((o.address as string | null) || (o.branch as string | null) || '').trim()
    if (place && !entry.addresses.includes(place)) entry.addresses.push(place)

    byPhone.set(key, entry)
  }

  const customers = [...byPhone.values()]
    .sort((a, b) => b.orders - a.orders)
    .slice(0, 20)

  return NextResponse.json({ customers })
}

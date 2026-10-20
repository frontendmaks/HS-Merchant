import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
import { getCurrentRole, canAccess } from '@/lib/getRole'
import {
  learnCityOblasts, customers as customerStats,
  type OrderRow, type Gazetteer,
} from '@/lib/analytics'
import gazetteerJson from '@/lib/ua-settlements.json'

const gazetteer = gazetteerJson as unknown as Gazetteer

/**
 * Список клієнтів періоду — окремим запитом, а не разом зі сторінкою.
 *
 * Він важить більше, ніж уся решта аналітики разом: тисяча з гаком рядків
 * з адресами, та ще й у шести зрізах по майданчиках. Сторінка через це
 * відкривалася довго, хоч таблиця клієнтів лежить аж унизу й до неї ще
 * треба догорнути.
 */
export async function GET(request: NextRequest) {
  const role = await getCurrentRole()
  if (!canAccess('analytics', role)) {
    return NextResponse.json({ error: 'Немає доступу' }, { status: 403 })
  }

  const q = request.nextUrl.searchParams
  const valid = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null)
  const from = valid(q.get('from'))
  const to = valid(q.get('to'))
  if (!from || !to) return NextResponse.json({ error: 'Невірний період' }, { status: 400 })

  const platform = q.get('platform') ?? 'all'
  const supabase = createServiceClient()

  const rows = await fetchAllRows(() => supabase.from('orders')
    .select('id, platform, order_date, customer_name, customer_phone, address, total, status, rz_city:raw->delivery->city, md_city:raw->delivery_address->city->>name, md_postal:raw->delivery_address->warehouse->>postal_code')
    .gte('order_date', from).lte('order_date', to)) as unknown as OrderRow[]

  const keep = (o: OrderRow) => {
    switch (platform) {
      case 'maudau': case 'rozetka': return o.platform === platform
      case 'site': return o.platform === 'site' || o.platform === 'manual'
      case 'web': return o.platform === 'site'
      case 'phone': return o.platform === 'manual'
      default: return true
    }
  }

  const slice = rows.filter(keep)
  return NextResponse.json({ customers: customerStats(slice, learnCityOblasts(slice), gazetteer) })
}

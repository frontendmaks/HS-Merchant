export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { getCurrentRole, canAccess } from '@/lib/getRole'
import { createServiceClient } from '@/lib/supabase/service'
import { firstAvailable, slotsForDate } from '@/lib/delivery-slots'
import ManualOrdersClient from './ManualOrdersClient'

export default async function ManualOrdersPage() {
  const role = await getCurrentRole()
  if (!canAccess('orders', role)) redirect('/')
  if (role === 'viewer') redirect('/orders')

  const service = createServiceClient()
  const start = firstAvailable()

  const [{ data: recent }, { data: zones }] = await Promise.all([
    service.from('orders')
      .select(`id, external_id, manual_number, delivery_date, delivery_slot, warehouse,
               customer_name, customer_phone, address, total, status, share_token, created_at`)
      .eq('platform', 'manual')
      .order('created_at', { ascending: false })
      .limit(30),
    service.from('delivery_zones').select('code, warehouse').order('code'),
  ])

  // Склади для ручного вибору, коли адресу не вдалось розпізнати
  const warehouses = [...new Set((zones ?? []).map(z => z.warehouse as string))].sort()

  return (
    <ManualOrdersClient
      recent={recent ?? []}
      warehouses={warehouses}
      initial={{ ...start, slots: slotsForDate(start.date) }}
    />
  )
}

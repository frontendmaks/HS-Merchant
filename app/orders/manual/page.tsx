export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { getCurrentRole, canAccess } from '@/lib/getRole'
import { createServiceClient } from '@/lib/supabase/service'
import { firstAvailable, slotsForDate } from '@/lib/delivery-slots'
import { getSetting } from '@/lib/settings'
import ManualOrdersClient from './ManualOrdersClient'

export default async function ManualOrdersPage() {
  const role = await getCurrentRole()
  if (!canAccess('orders', role)) redirect('/')
  if (role === 'viewer') redirect('/orders')

  const service = createServiceClient()
  const buffer = await getSetting(service, 'delivery_buffer_minutes')
  const start = firstAvailable(buffer)

  const [{ data: recent }, { data: zones }] = await Promise.all([
    service.from('orders')
      .select(`id, external_id, manual_number, delivery_date, delivery_slot, warehouse,
               customer_name, customer_phone, address, total, status, share_token, created_at`)
      .eq('platform', 'manual')
      .order('created_at', { ascending: false })
      .limit(30),
    service.from('delivery_zones').select('code, warehouse, polygon').order('code'),
  ])

  // Склади для ручного вибору, коли адресу не вдалось розпізнати
  const warehouses = [...new Set((zones ?? []).map(z => z.warehouse as string))].sort()

  return (
    <ManualOrdersClient
      recent={recent ?? []}
      warehouses={warehouses}
      initial={{ ...start, slots: slotsForDate(start.date, buffer) }}
      // Прив'язка чатів — разове налаштування, і міняти його має той, хто
      // відповідає за налаштування, а не кожен, хто приймає замовлення
      canSetChats={role === 'super_admin' || role === 'admin'}
      buffer={buffer}
      zones={(zones ?? []).map(z => ({
        code: z.code as string,
        warehouse: z.warehouse as string,
        polygon: (z.polygon as { lat: number; lng: number }[]) ?? [],
      }))}
    />
  )
}

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor } from '@/lib/order-events'
import { resolveAddress } from '@/lib/delivery-zones'
import { slotsForDate, firstAvailable } from '@/lib/delivery-slots'
import { getSetting } from '@/lib/settings'

/**
 * POST /api/orders/manual/resolve
 *
 * Адреса → склад, і доступні періоди на дату. Одним запитом, бо оператор
 * питає обидва одночасно: вписав адресу — хоче бачити, звідки поїде й коли
 * можна привезти.
 */
export async function POST(req: NextRequest) {
  if (!await currentActor()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { address, date } = await req.json().catch(() => ({})) as
    { address?: string; date?: string }

  const service = createServiceClient()
  const resolved = address?.trim()
    ? await resolveAddress(service, address)
    : { point: null, zone: null, warehouse: null, note: null }

  const buffer = await getSetting(service, 'delivery_buffer_minutes')
  const when = date || firstAvailable(buffer).date

  return NextResponse.json({
    zone: resolved.zone,
    warehouse: resolved.warehouse,
    note: resolved.note,
    coordinates: resolved.point ? { lat: resolved.point.lat, lng: resolved.point.lng } : null,
    matched_address: resolved.point?.display_name ?? null,
    date: when,
    slots: slotsForDate(when, buffer),
  })
}

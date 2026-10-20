import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor } from '@/lib/order-events'
import { resolveAddress, GeocoderUnavailable } from '@/lib/delivery-zones'
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

  /**
   * Мовчання геокодера — не вирок адресі.
   *
   * Оператор на лінії з клієнтом: сказати йому «адресу не розпізнано», коли
   * насправді не відповів чужий сервіс, означає змусити правити те, що й так
   * правильне. Кажемо як є — і склад він обере сам.
   */
  let resolved: Awaited<ReturnType<typeof resolveAddress>> =
    { point: null, zone: null, warehouse: null, note: null }

  if (address?.trim()) {
    try {
      resolved = await resolveAddress(service, address)
    } catch (e) {
      resolved = {
        point: null, zone: null, warehouse: null,
        note: e instanceof GeocoderUnavailable
          ? 'Довідник адрес не відповідає — оберіть склад вручну'
          : 'Адресу не вдалося перевірити — оберіть склад вручну',
      }
    }
  }

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

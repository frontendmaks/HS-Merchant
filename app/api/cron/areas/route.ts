import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveAddress, areaFromDisplay, GeocoderUnavailable } from '@/lib/delivery-zones'

export const maxDuration = 300

/**
 * Добір району й зони для старих замовлень.
 *
 * Зону й район проставляє автопілот, а він дивиться лише на найближчі
 * доби — усе, що перенесено з Бітрікса заднім числом, лишилось без них.
 * На карті це виглядало так, ніби возимо вчетверо менше, ніж возимо.
 *
 * Склад тут не чіпаємо: він прийшов з Бітрікса, тобто з того, хто
 * замовлення справді збирав, і краще за будь-який геокодер знає правду.
 * Шукаємо тільки те, чого бракує.
 */
export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const limit = Math.min(Number(request.nextUrl.searchParams.get('limit') ?? 30), 500)
  const service = createServiceClient()

  const { data } = await service
    .from('orders')
    .select('id, address, area, delivery_zone')
    .in('platform', ['site', 'manual'])
    .not('address', 'is', null)
    .or('area.is.null,delivery_zone.is.null')
    .order('order_date', { ascending: false })
    .limit(limit)

  const orders = data ?? []
  let resolved = 0
  let blank = 0

  for (const order of orders) {
    const address = (order.address as string | null)?.trim()
    if (!address) continue

    try {
      const hit = await resolveAddress(service, address)
      const patch: Record<string, unknown> = {
        area: areaFromDisplay(hit.point?.display_name) ?? null,
      }
      if (hit.zone) patch.delivery_zone = hit.zone

      await service.from('orders').update(patch).eq('id', order.id as string)
      if (patch.area || hit.zone) resolved++
      else blank++
    } catch (e) {
      // Геокодер замовк — це не відповідь про адресу; спинаємось і
      // лишаємо решту наступному проходу
      if (e instanceof GeocoderUnavailable) {
        return NextResponse.json({ looked: orders.length, resolved, blank, stopped: 'геокодер не відповідає' })
      }
      blank++
    }
  }

  return NextResponse.json({ looked: orders.length, resolved, blank })
}

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor } from '@/lib/order-events'
import { getCurrentRole, canAccess } from '@/lib/getRole'

/** Confirming or rejecting what the matcher proposed. A rejected pair is not
 *  proposed again, so the same wrong guess is only ever dismissed once. */
export async function PATCH(req: NextRequest) {
  if (!await currentActor()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canAccess('priceMonitor', await getCurrentRole())) {
    return NextResponse.json({ error: 'Немає доступу' }, { status: 403 })
  }

  const { id, status, choose } = await req.json() as {
    id: string; status?: string; choose?: boolean
  }

  const service = createServiceClient()

  // Picking which of a competitor's offers we compare against. Exclusive per
  // competitor: two chosen offers would be two prices from one shop.
  if (choose) {
    const { data: row } = await service
      .from('price_matches').select('product_id, competitor_id').eq('id', id).single()
    if (!row) return NextResponse.json({ error: 'Не знайдено' }, { status: 404 })

    await service.from('price_matches').update({ is_chosen: false })
      .eq('product_id', row.product_id).eq('competitor_id', row.competitor_id)

    const { error } = await service.from('price_matches')
      .update({ is_chosen: true, status: 'confirmed' }).eq('id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (!status || !['auto', 'confirmed', 'rejected'].includes(status)) {
    return NextResponse.json({ error: 'Невідомий статус' }, { status: 400 })
  }

  const patch: Record<string, unknown> = { status }
  // A rejected offer is no longer the one we compare against either
  if (status === 'rejected') patch.is_chosen = false

  const { error } = await service.from('price_matches').update(patch).eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

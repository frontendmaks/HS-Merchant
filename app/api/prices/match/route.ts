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

  const { id, status } = await req.json() as { id: string; status: string }
  if (!['auto', 'confirmed', 'rejected'].includes(status)) {
    return NextResponse.json({ error: 'Невідомий статус' }, { status: 400 })
  }

  const patch: Record<string, unknown> = { status }
  // A rejection is about the pairing, so the price it carried goes with it
  if (status === 'rejected') { patch.price = null; patch.competitor_title = null }

  const { error } = await createServiceClient()
    .from('price_matches').update(patch).eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

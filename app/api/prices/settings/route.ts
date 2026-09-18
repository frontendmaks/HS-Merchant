import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor } from '@/lib/order-events'
import { getCurrentRole, canAccess } from '@/lib/getRole'

/** Where the line between noise and a pricing problem sits. */
export async function PATCH(req: NextRequest) {
  const actor = await currentActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canAccess('priceMonitor', await getCurrentRole())) {
    return NextResponse.json({ error: 'Немає доступу' }, { status: 403 })
  }

  const body = await req.json() as Record<string, unknown>

  // Clamped rather than trusted: a zero threshold would flag every rounding
  // difference, and a huge one would quietly switch the page off
  const num = (v: unknown, lo: number, hi: number, fallback: number) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback
  }

  const { error } = await createServiceClient().from('price_settings').update({
    min_abs_uah: num(body.minAbs, 0, 10_000, 15),
    min_pct: num(body.minPct, 0, 90, 5),
    undercut_pct: num(body.undercutPct, 0, 50, 2),
    updated_by: actor.id,
    updated_at: new Date().toISOString(),
  }).eq('id', true)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

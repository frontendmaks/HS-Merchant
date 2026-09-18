export const maxDuration = 300

import { NextResponse } from 'next/server'
import { currentActor } from '@/lib/order-events'
import { getCurrentRole, canAccess } from '@/lib/getRole'
import { runPriceCheck } from '@/lib/price-run'

/** The same pass the 09:30 job makes, on demand. */
export async function POST() {
  if (!await currentActor()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canAccess('priceMonitor', await getCurrentRole())) {
    return NextResponse.json({ error: 'Немає доступу' }, { status: 403 })
  }
  try {
    return NextResponse.json({ ok: true, ...(await runPriceCheck()) })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}

export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { processMarketplaceOrders } from '@/lib/marketplace-autopilot'
import { getSetting } from '@/lib/settings'
import { bitrixConfigured } from '@/lib/bitrix'
import { logCronRun } from '@/lib/cron-log'

/**
 * Приймання маркетплейсних замовлень і перенесення їх у Бітрікс.
 *
 * Вимкнене, поки не ввімкнули: прийняти замовлення на майданчику — це
 * обіцянка покупцеві.
 */
export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!bitrixConfigured()) {
    return NextResponse.json({ skipped: 'Бітрікс не налаштовано' })
  }

  const service = createServiceClient()
  if (!await getSetting(service, 'marketplace_autoprocess')) {
    return NextResponse.json({ skipped: 'Опрацювання маркетплейсів вимкнено' })
  }

  const startedAt = Date.now()
  const limit = Math.min(Math.max(
    Number(new URL(request.url).searchParams.get('limit') ?? 10), 1), 40)

  const result = await processMarketplaceOrders(service, { limit })
  await logCronRun(service, 'marketplace-autopilot', startedAt, result, result.error)

  return NextResponse.json(result, { status: result.error ? 500 : 200 })
}

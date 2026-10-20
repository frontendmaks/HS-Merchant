import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor } from '@/lib/order-events'
import { syncSiteOrders } from '@/lib/bitrix-sync'
import { bitrixConfigured } from '@/lib/bitrix'

/**
 * POST /api/orders/site/sync — забрати зміни з Бітрікса зараз.
 *
 * Те саме, що робить розклад, але на вимогу: оператор щойно щось змінив у
 * CRM і хоче побачити це тут, не чекаючи наступного запуску.
 */
export async function POST(req: NextRequest) {
  if (!await currentActor()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!bitrixConfigured()) {
    return NextResponse.json({ error: 'Бітрікс не налаштовано' }, { status: 503 })
  }

  const body = await req.json().catch(() => ({})) as {
    days?: number
    /** Добір минулого: шукати за датою створення й продовжувати сторінками */
    backfill?: boolean
    page?: number
  }
  // Більше трьох місяців за раз не беремо: у воронці сто двадцять тисяч
  // угод, і випадкове «за рік» означало б години роботи
  const days = Math.min(Math.max(Number(body?.days) || 3, 1), 92)

  const since = new Date(Date.now() - days * 24 * 3600_000).toISOString()
  const result = await syncSiteOrders(createServiceClient(), {
    since,
    maxPages: body?.backfill ? 6 : 40,
    byCreated: !!body?.backfill,
    startPage: Number(body?.page) || 0,
  })

  return NextResponse.json(result, { status: result.error ? 500 : 200 })
}

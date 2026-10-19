export const maxDuration = 120

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { syncSiteOrders } from '@/lib/bitrix-sync'
import { bitrixConfigured } from '@/lib/bitrix'

/**
 * Замовлення з сайту — що змінилось за останню добу.
 *
 * Добу, а не п'ять хвилин: вікно має перекривати пропущені запуски, інакше
 * одна невдала спроба лишає замовлення невидимими назавжди. Угода, яку ми вже
 * бачили, просто оновиться тими самими даними.
 */
export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!bitrixConfigured()) {
    return NextResponse.json({ skipped: 'BITRIX_WEBHOOK_URL не налаштовано' })
  }

  const since = new Date(Date.now() - 24 * 3600_000).toISOString()
  const result = await syncSiteOrders(createServiceClient(), { since, maxPages: 20 })

  return NextResponse.json(result, { status: result.error ? 500 : 200 })
}

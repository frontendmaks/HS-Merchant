import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { syncMarketplaceChats } from '@/lib/chat-marketplaces'
import { logCronRun } from '@/lib/cron-log'

export const maxDuration = 120

/**
 * Повідомлення покупців з Rozetka і Prom.
 *
 * Обидва майданчики самі нічого не надсилають, тож питаємо їх часто: від
 * того, як швидко оператор побачить питання, залежить, чи купить покупець.
 */
export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const service = createServiceClient()
  const startedAt = Date.now()
  const result = await syncMarketplaceChats(service)
  const errors = [...result.prom.errors, ...result.rozetka.errors]
  await logCronRun(service, 'chats', startedAt, result, errors.length ? errors.join('; ').slice(0, 500) : undefined)

  return NextResponse.json(result, { status: errors.length ? 207 : 200 })
}

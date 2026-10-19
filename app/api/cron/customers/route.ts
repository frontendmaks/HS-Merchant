export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { importContacts } from '@/lib/bitrix-contacts'
import { bitrixConfigured } from '@/lib/bitrix'

/**
 * База клієнтів: перерахунок із замовлень і довантаження контактів із CRM.
 *
 * Повний імпорт сорока семи тисяч контактів не влазить в одне виконання, тож
 * він іде шматками: кожен виклик бере свою порцію й каже, звідки продовжити.
 * Розклад доходить до кінця за кілька запусків, а `?start=` дозволяє
 * продовжити вручну.
 */
export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const service = createServiceClient()
  const { data: refreshed } = await service.rpc('refresh_customers_from_orders')

  if (!bitrixConfigured()) {
    return NextResponse.json({ from_orders: refreshed, contacts: 'Бітрікс не налаштовано' })
  }

  const url = new URL(request.url)
  const start = Number(url.searchParams.get('start') ?? 0)
  const rounds = Math.min(Math.max(Number(url.searchParams.get('rounds') ?? 1), 1), 8)

  let cursor: number | null = start
  let read = 0
  let saved = 0
  let error: string | undefined

  for (let i = 0; i < rounds && cursor !== null; i++) {
    const result = await importContacts(service, cursor)
    read += result.read
    saved += result.saved
    cursor = result.next
    if (result.error) { error = result.error; break }
  }

  return NextResponse.json({ from_orders: refreshed, read, saved, next: cursor, error })
}

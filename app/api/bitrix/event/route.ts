export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { syncSiteOrders } from '@/lib/bitrix-sync'
import { autoProcessSiteOrders } from '@/lib/site-autopilot'
import { getSetting } from '@/lib/settings'
import { CATEGORY_ID } from '@/lib/bitrix-deal'

/**
 * POST /api/bitrix/event — Бітрікс сам каже, що змінилось.
 *
 * Розклад опитує CRM раз на чверть години, і цього вистачає, щоб нічого не
 * загубити, але не вистачає, щоб працювати поруч із людиною: оператор
 * перевів замовлення на комплектацію й дивиться в екран. Вихідний вебхук
 * Бітрікса приносить сюди номер угоди тієї ж секунди, і ми перечитуємо саме
 * її — не всю воронку.
 *
 * Опитування лишається: подію можна не доставити, а розклад догляне.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'Bad request' }, { status: 400 })

  /**
   * Бітрікс присилає свій токен застосунку — він і є ключем.
   *
   * Без перевірки будь-хто, знаючи адресу, змушував би нас перечитувати
   * CRM скільки завгодно разів.
   */
  const token = String(form.get('auth[application_token]') ?? '')
  const expected = process.env.BITRIX_EVENT_TOKEN
  if (!expected || token !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const event = String(form.get('event') ?? '')
  const dealId = String(form.get('data[FIELDS][ID]') ?? '').trim()
  if (!dealId || !/^\d+$/.test(dealId)) {
    return NextResponse.json({ ok: true, skipped: 'немає номера угоди' })
  }

  const service = createServiceClient()

  // Фільтр за воронкою — у самій синхронізації: угоди інших воронок просто
  // не повернуться, і ми нічого з ними не зробимо
  const sync = await syncSiteOrders(service, { dealIds: [dealId], maxPages: 1 })

  let auto = null
  if (sync.created || sync.updated) {
    const { data: order } = await service
      .from('orders').select('id').eq('bitrix_deal_id', Number(dealId)).maybeSingle()

    if (order && await getSetting(service, 'auto_process_site_orders')) {
      auto = await autoProcessSiteOrders(service, { orderIds: [order.id as string], limit: 1 })
    }
  }

  return NextResponse.json({ ok: true, event, deal: dealId, category: CATEGORY_ID, sync, auto })
}

/** Бітрікс перевіряє адресу GET-запитом, перш ніж зберегти вебхук. */
export function GET() {
  return NextResponse.json({ ok: true })
}

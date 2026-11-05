export const maxDuration = 180

import { NextRequest, NextResponse, after } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { drainBitrixEvents } from '@/lib/bitrix-event-queue'
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
   * Ключ — або в тілі, або в самій адресі.
   *
   * Бітрікс присилає власний токен застосунку, і якщо його вписали нашим,
   * підходить він. Але поле з токеном у формі вихідного вебхука буває
   * недоступним для редагування, тож приймаємо ключ і з адреси: той, хто
   * налаштовує, вписує одне посилання й більше нічого.
   *
   * Без перевірки будь-хто, знаючи адресу, змушував би нас перечитувати CRM
   * скільки завгодно разів.
   */
  const expected = process.env.BITRIX_EVENT_TOKEN
  const fromBody = String(form.get('auth[application_token]') ?? '')
  const fromUrl = new URL(req.url).searchParams.get('key') ?? ''

  if (!expected || (fromBody !== expected && fromUrl !== expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const event = String(form.get('event') ?? '')
  const dealId = String(form.get('data[FIELDS][ID]') ?? '').trim()
  if (!dealId || !/^\d+$/.test(dealId)) {
    return NextResponse.json({ ok: true, skipped: 'немає номера угоди' })
  }

  const service = createServiceClient()
  const { error } = await service.rpc('merchant_enqueue_bitrix', { p_deal_id: Number(dealId) })
  if (error) return NextResponse.json({ ok: false, error: 'Не вдалося прийняти подію' }, { status: 503 })
  // Acknowledge only after durable enqueue. Bursts for one deal coalesce.
  after(() => drainBitrixEvents(1))
  return NextResponse.json({ ok: true, queued: true, event, deal: dealId, category: CATEGORY_ID })
}

/** Бітрікс перевіряє адресу GET-запитом, перш ніж зберегти вебхук. */
export function GET() {
  return NextResponse.json({ ok: true })
}

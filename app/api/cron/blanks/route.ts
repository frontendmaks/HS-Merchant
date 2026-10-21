import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { sendOrderSheet, blankDue, kyivToday } from '@/lib/bitrix-chat'
import { logCronRun } from '@/lib/cron-log'
import { CLOSED_STAGES } from '@/lib/bitrix-stages'

export const maxDuration = 300

/**
 * Ранкова розсилка бланків.
 *
 * Замовлення на п'ятницю, прийняте в середу, складу в середу не потрібне:
 * воно загубиться серед сьогоднішніх, а в п'ятницю вранці його ніхто не
 * шукатиме в позавчорашній стрічці. Тож бланк чекає до п'ятої ранку свого
 * дня — і тоді комплектація бачить усе, що везуть сьогодні, одним списком.
 *
 * Прохід ходить кілька разів уранці: розклад Vercel рахує в UTC, а п'ята
 * ранку в Києві припадає то на другу, то на третю — залежно від пори року.
 * Зайвий виклик нічого не коштує: він просто нічого не знаходить.
 */
export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const service = createServiceClient()
  const startedAt = Date.now()
  const today = kyivToday()

  // Ще не п'ята — нічого не робимо, навіть якщо розклад розбудив
  if (!blankDue(today)) {
    return NextResponse.json({ waiting: 'ще не п\'ята ранку за Києвом' })
  }

  const { data } = await service
    .from('orders')
    .select('id, external_id, warehouse, delivery_date')
    .is('chat_sent_at', null)
    .not('chat_due_at', 'is', null)
    .lte('chat_due_at', new Date().toISOString())
    .not('status', 'in', `(${CLOSED_STAGES.map(s => `"${s}"`).join(',')})`)
    .order('delivery_date', { ascending: true })
    .limit(200)

  const orders = data ?? []
  let sent = 0
  const problems: { order: string; error: string }[] = []

  for (const order of orders) {
    const r = await sendOrderSheet(service, order.id as string)
    if ('error' in r) problems.push({ order: (order.external_id as string) ?? '—', error: r.error })
    else sent++
  }

  const result = { looked: orders.length, sent, problems }
  await logCronRun(service, 'blanks', startedAt, result)
  return NextResponse.json(result)
}

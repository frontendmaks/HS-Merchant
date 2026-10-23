import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { enrichNewCards, tidyFailed, numberInPicking } from '@/lib/trello-cards'
import { logCronRun } from '@/lib/cron-log'

export const maxDuration = 120

/**
 * Дописування карток у «Нових замовленнях».
 *
 * Ходить часто: картка з'являється через кілька хвилин після того, як
 * замовлення потрапило в Бітрікс, і номер ящика має стояти в ній до того,
 * як її візьме в роботу людина.
 */
export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const service = createServiceClient()
  const limit = Math.min(Number(request.nextUrl.searchParams.get('limit') ?? 40), 200)

  const startedAt = Date.now()
  const result = await enrichNewCards(service, { limit })

  /*
   * Прибирання — зрідка, а не щопроходу.
   *
   * Прохід ходить кожні три хвилини, і перечитувати заради цього сотню
   * карток «Не доставлено» щоразу означало б витрачати більшість
   * запитів до Trello на те, що міняється раз на день.
   */
  const tidy = request.nextUrl.searchParams.get('tidy') === '1'
    || new Date().getUTCHours() === 4
  const cleaned = tidy ? await tidyFailed(service) : null

  /*
   * Те, що змінилось уже після переїзду картки.
   *
   * Номер міг з'явитись пізніше, а склад — змінитись зовсім: виправили
   * адресу, геокодер упізнав вулицю, оператор обрав інший руками. Картка
   * при цьому стоїть там, куди її поклали вперше.
   */
  const late = await numberInPicking(service)

  await logCronRun(service, 'trello-cards', startedAt,
    { ...result, cleaned, late }, result.error)

  return NextResponse.json({ ...result, cleaned, late })
}

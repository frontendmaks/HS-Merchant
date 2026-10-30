export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { autoProcessSiteOrders, retryStranded, sendMissingSheets } from '@/lib/site-autopilot'
import { getSetting } from '@/lib/settings'
import { bitrixConfigured } from '@/lib/bitrix'
import { logCronRun } from '@/lib/cron-log'

/**
 * Огляд замовлень із сайту — окремо від синхронізації.
 *
 * Разом вони не вкладались у час: синхронізація ходить по сотнях угод, а
 * огляд одного замовлення — це геокодер і журнал, кожен зі своїми паузами.
 * Тут беремо маленькими порціями, щоб кожен запуск завершувався, а не вмирав
 * посередині.
 */
export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!bitrixConfigured()) {
    return NextResponse.json({ skipped: 'Бітрікс не налаштовано' })
  }

  const service = createServiceClient()
  if (!await getSetting(service, 'auto_process_site_orders')) {
    return NextResponse.json({ skipped: 'Самостійне опрацювання вимкнено' })
  }

  const limit = Math.min(Math.max(
    Number(new URL(request.url).searchParams.get('limit') ?? 30), 1), 60)

  const startedAt = Date.now()
  const result = await autoProcessSiteOrders(service, { limit })

  /*
   * Заразом підбираємо те, що не доїхало до Бітрікса.
   *
   * Окремий розклад на це заводити не варто: прохід і так ходить що три
   * хвилини, а невдалих заведень одиниці.
   */
  const stranded = await retryStranded(service)

  /* І бланки, які не дійшли до складу через збій тієї миті */
  const sheets = await sendMissingSheets(service)

  await logCronRun(service, 'site-autopilot', startedAt,
    { ...result, stranded, sheets }, result.error)
  return NextResponse.json({ ...result, stranded, sheets },
    { status: result.error ? 500 : 200 })
}

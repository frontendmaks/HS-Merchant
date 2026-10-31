/*
 * П'ять хвилин, а не дві.
 *
 * Широкий прохід — той, що раз на годину перечитує добу, — не вкладався
 * у дві хвилини ніколи. Його вбивало на півдорозі, і вбите виконання не
 * лишає навіть сліду в журналі: за добу жодного запису про нього, хоч
 * розклад викликав його двадцять чотири рази. Саме він мав підбирати
 * замовлення, що загубились під час збою, — і саме він не працював.
 *
 * Півгодинний теж підходив до межі впритул: найдовший за добу —
 * 120.6 секунди при межі в 120.
 */
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { syncSiteOrders } from '@/lib/bitrix-sync'
import { bitrixConfigured } from '@/lib/bitrix'
import { logCronRun } from '@/lib/cron-log'

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

  const service = createServiceClient()

  /**
   * Вікно — скільки часу назад перечитувати.
   *
   * Часті проходи дивляться на останні пів години: за цей час у воронці
   * змінюється кілька угод, і прохід коштує копійки. Раз на годину йде
   * широкий — за добу, — щоб підібрати те, що проґавилось під час збою чи
   * простою.
   */
  const params = new URL(request.url).searchParams
  const minutes = Math.min(Math.max(Number(params.get('minutes') ?? 30), 5), 200_000)

  /**
   * Добір минулого — окремий режим.
   *
   * Шукає за датою створення й іде частинами: тисячі угод в один виклик не
   * вкладаються, а розклад тим часом має й далі ходити по своєму вікну.
   */
  const backfill = params.get('backfill') === '1'
  const startPage = Number(params.get('page') ?? 0)
  // Скільки сторінок за виклик: сто п'ятдесят угод — це близько двох
  // хвилин, і це вже половина відведеного часу
  const pages = Math.min(Math.max(Number(params.get('pages') ?? 3), 1), 8)

  const startedAt = Date.now()
  const since = new Date(Date.now() - minutes * 60_000).toISOString()
  const result = await syncSiteOrders(service, {
    since,
    maxPages: backfill ? pages : minutes > 120 ? 20 : 4,
    byCreated: backfill,
    startPage,
  })

  await logCronRun(service, 'bitrix-sync', startedAt, { ...result, minutes }, result.error)
  return NextResponse.json({ ...result, minutes }, { status: result.error ? 500 : 200 })
}

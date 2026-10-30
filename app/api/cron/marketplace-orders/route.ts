export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { processMarketplaceOrders } from '@/lib/marketplace-autopilot'
import { pushMarketplaceOrder } from '@/lib/marketplace-bitrix'
import { getSetting } from '@/lib/settings'
import { bitrixConfigured } from '@/lib/bitrix'
import { logCronRun } from '@/lib/cron-log'

/**
 * Приймання маркетплейсних замовлень і перенесення їх у Бітрікс.
 *
 * Вимкнене, поки не ввімкнули: прийняти замовлення на майданчику — це
 * обіцянка покупцеві.
 */
export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!bitrixConfigured()) {
    return NextResponse.json({ skipped: 'Бітрікс не налаштовано' })
  }

  const service = createServiceClient()
  if (!await getSetting(service, 'marketplace_autoprocess')) {
    return NextResponse.json({ skipped: 'Опрацювання маркетплейсів вимкнено' })
  }

  const startedAt = Date.now()
  const limit = Math.min(Math.max(
    Number(new URL(request.url).searchParams.get('limit') ?? 10), 1), 40)

  /*
   * Перезаписати вже заведені угоди.
   *
   * Потрібне, коли змінилось те, як ми їх складаємо: угода вже існує, і
   * звичайний прохід її не чіпає. Викликається руками, не за розкладом.
   *
   * Обережно: перезапис кладе наші рядки поверх тих, що в угоді зараз.
   * Якщо оператор уже поправив її руками — дописав позицію, замінив
   * товар, — ця правка зникне. Тому є `order=MD-…`: перезаписати рівно
   * одну, названу угоду, замість «останніх N навмання».
   */
  const only = request.nextUrl.searchParams.get('order')
  const repush = Number(request.nextUrl.searchParams.get('repush') ?? 0)
  if (repush > 0 || only) {
    const q = service
      .from('orders')
      .select('id, external_id')
      .in('platform', ['maudau', 'rozetka'])
      .not('bitrix_deal_id', 'is', null)

    const { data } = only
      ? await q.eq('external_id', only)
      : await q.order('order_date', { ascending: false })
          .limit(Math.min(repush, 100))

    const again = []
    for (const o of data ?? []) {
      const r = await pushMarketplaceOrder(service, o.id as string)
      again.push({ order: o.external_id, ...r })
    }
    return NextResponse.json({ repushed: again.length, again })
  }

  const result = await processMarketplaceOrders(service, { limit })
  await logCronRun(service, 'marketplace-autopilot', startedAt, result, result.error)

  return NextResponse.json(result, { status: result.error ? 500 : 200 })
}

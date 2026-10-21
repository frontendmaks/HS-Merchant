/**
 * Закриття дня: усе, що збиралось, стає виконаним.
 *
 * Опівночі робота дня скінчена: те, що везли, доїхало, і лишати його в
 * «Комплектується» означає щоранку бачити вчорашню чергу поверх
 * сьогоднішньої. Оператор може перевести замовлення й раніше — тоді
 * ввечері його тут уже не буде.
 *
 * Чіпаємо лише той день, який закривається. Замовлення, що зависло з
 * позавчора, — це питання до людини, а не привід тихо його закрити.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { changeOrderStatus } from '@/lib/order-status-change'

type Service = ReturnType<typeof createServiceClient>

const PICKING = 'Комплектується'
const DONE = 'Виконано'

export interface CloseResult {
  looked: number
  done: number
  problems: { order: string; error: string }[]
}

export async function closeDay(
  service: Service,
  { date, limit = 200 }: { date: string; limit?: number },
): Promise<CloseResult> {
  const result: CloseResult = { looked: 0, done: 0, problems: [] }

  const { data } = await service
    .from('orders')
    .select('id, external_id, platform, status')
    .in('platform', ['site', 'manual'])
    .eq('delivery_date', date)
    .eq('status', PICKING)
    .limit(limit)

  const orders = data ?? []
  result.looked = orders.length

  for (const order of orders) {
    /*
     * Через той самий шлях, що й руками.
     *
     * Він сам оновить і базу, і стадію угоди, і запише в журнал, хто
     * це зробив. Окрема гілка «тільки для ночі» колись розійшлася б із
     * денною, і ніхто б не помітив.
     */
    const res = await changeOrderStatus({
      id: order.id as string,
      status: DONE,
      platform: (order.platform as string) ?? 'site',
      external_id: (order.external_id as string) ?? '',
      actor: { id: '', name: 'Закриття дня' },
    })

    const body = await res.json().catch(() => ({})) as { success?: boolean; error?: string }
    if (body.success) result.done++
    else {
      result.problems.push({
        order: (order.external_id as string) ?? '—',
        error: body.error ?? 'не вдалося',
      })
    }
  }

  return result
}

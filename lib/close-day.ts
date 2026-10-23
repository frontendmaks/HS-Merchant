/**
 * Закриття дня: усе, що збиралось, стає виконаним.
 *
 * Опівночі робота дня скінчена: те, що везли, доїхало, і лишати його в
 * «Комплектується» чи «Спаковано» означає щоранку бачити вчорашню чергу
 * поверх сьогоднішньої. Оператор може перевести замовлення й раніше — тоді
 * ввечері його тут уже не буде.
 *
 * Чіпаємо лише той день, який закривається. Замовлення, що зависло з
 * позавчора, — це питання до людини, а не привід тихо його закрити.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { changeOrderStatus } from '@/lib/order-status-change'

type Service = ReturnType<typeof createServiceClient>

/**
 * Що саме закриваємо.
 *
 * І «Комплектується», і «Спаковано» — це робота складу над сьогоднішнім
 * замовленням. Спаковане ввечері так само поїхало, як і зібране, і
 * лишати його відкритим означає нести вчорашнє в завтрашній список.
 */
const WORKING = ['Комплектується', 'Спаковано']
const DONE = 'Виконано'

export interface CloseResult {
  looked: number
  done: number
  /** Скільки з них лишались у роботі з минулих днів */
  stale: number
  problems: { order: string; error: string }[]
}

export async function closeDay(
  service: Service,
  { date, limit = 200 }: { date: string; limit?: number },
): Promise<CloseResult> {
  const result: CloseResult = { looked: 0, done: 0, stale: 0, problems: [] }

  /*
   * Закриваємо не лише цей день, а й усе прострочене.
   *
   * Прохід о 23:59 бере те, що в роботі саме зараз, — і цього досить,
   * поки нічого не змінюється після опівночі. Але склад позначає
   * «Спаковано» і вранці наступного дня: замовлення Андрейкіної та
   * Горин за 22 жовтня перевели в Бітріксі о 10:30 двадцять третього,
   * коли нічний прохід уже відпрацював. Такі лишались у роботі назавжди
   * — наступної ночі їх ніхто не чіпав, бо день уже був інший.
   *
   * Тож беремо все, чия дата доставки не пізніша за цю. Горизонт у два
   * тижні: глибше лежить те, з чим має розбиратись людина, а не прохід.
   */
  const horizon = (() => {
    const d = new Date(`${date}T12:00:00`)
    d.setDate(d.getDate() - 14)
    return d.toLocaleDateString('en-CA')
  })()

  const { data } = await service
    .from('orders')
    .select('id, external_id, platform, status, delivery_date')
    .in('platform', ['site', 'manual'])
    .lte('delivery_date', date)
    .gte('delivery_date', horizon)
    .in('status', WORKING)
    .order('delivery_date')
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
    if (body.success) {
      result.done++
      if (order.delivery_date !== date) result.stale++
    }
    else {
      result.problems.push({
        order: (order.external_id as string) ?? '—',
        error: body.error ?? 'не вдалося',
      })
    }
  }

  return result
}

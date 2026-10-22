/**
 * Чи ще існує угода, на яку посилається замовлення.
 *
 * Угоду в Бітріксі можна видалити або перенести в іншу воронку, і в
 * Мерчанті від цього не змінюється нічого: замовлення далі в роботі, на
 * ньому номер ящика, склад його збирає. Дізнаємось ми про розрив лише
 * тоді, коли хтось піде шукати угоду й не знайде — а це вже посеред дня.
 *
 * Тож питаємо самі: за списком угод, які ми вважаємо своїми, і одразу
 * пачками. Те, що не повернулось, позначаємо на замовленні — так само,
 * як позначаємо будь-яку іншу ваду, що потребує людини.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { bitrix } from '@/lib/bitrix'
import { CATEGORY_ID } from '@/lib/bitrix-deal'

type Service = ReturnType<typeof createServiceClient>

/** Текст ставимо той самий, щоб його можна було і знайти, і зняти */
export const MISSING_NOTE = 'угоди немає в Бітріксі'
export const MOVED_NOTE = 'угоду перенесено в іншу воронку'

/** Скільки угод питаємо за раз: більше Бітрікс віддає неохоче */
const CHUNK = 50

export interface CheckResult {
  looked: number
  missing: number
  moved: number
  healed: number
  ids: number[]
}

export async function checkDeals(
  service: Service,
  { days = 14, limit = 600 }: { days?: number; limit?: number } = {},
): Promise<CheckResult> {
  const result: CheckResult = { looked: 0, missing: 0, moved: 0, healed: 0, ids: [] }

  const horizon = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)

  /*
   * Дивимось тільки на живі замовлення найближчих днів.
   *
   * Угода торішнього замовлення може бути видалена цілком законно — при
   * чистці CRM, — і сповіщати про це означало б щодня показувати те, з
   * чим ніхто нічого не робитиме.
   */
  const { data } = await service
    .from('orders')
    .select('id, bitrix_deal_id, bitrix_error')
    .in('platform', ['site', 'manual'])
    .not('bitrix_deal_id', 'is', null)
    .gte('delivery_date', horizon)
    .not('status', 'in', '("Скасовано","Повернено","Не вдалося")')
    .limit(limit)

  const orders = (data ?? []) as {
    id: string; bitrix_deal_id: number; bitrix_error: string | null
  }[]
  result.looked = orders.length
  if (!orders.length) return result

  const alive = new Map<number, string>()

  for (let i = 0; i < orders.length; i += CHUNK) {
    const ids = orders.slice(i, i + CHUNK).map(o => o.bitrix_deal_id)
    const deals = await bitrix<{ ID: string; CATEGORY_ID: string }[]>('crm.deal.list', {
      filter: { ID: ids },
      select: ['ID', 'CATEGORY_ID'],
    })
    for (const d of deals ?? []) alive.set(Number(d.ID), String(d.CATEGORY_ID))
  }

  for (const order of orders) {
    const category = alive.get(order.bitrix_deal_id)
    const note = category === undefined
      ? MISSING_NOTE
      : Number(category) !== CATEGORY_ID ? MOVED_NOTE : null

    const had = order.bitrix_error === MISSING_NOTE || order.bitrix_error === MOVED_NOTE

    if (note) {
      result.ids.push(order.bitrix_deal_id)
      if (note === MISSING_NOTE) result.missing++; else result.moved++
      if (order.bitrix_error !== note) {
        await service.from('orders').update({ bitrix_error: note }).eq('id', order.id)
      }
    } else if (had) {
      /*
       * Угода повернулась — знімаємо позначку.
       *
       * Її могли видалити помилково й відновити, або перенести назад.
       * Мітка, що лишилась після зникнення причини, через тиждень
       * перестає щось означати.
       */
      await service.from('orders').update({ bitrix_error: null }).eq('id', order.id)
      result.healed++
    }
  }

  return result
}

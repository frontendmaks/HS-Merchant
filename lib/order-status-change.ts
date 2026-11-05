/**
 * Зміна статусу замовлення — в одному місці для всіх, хто її робить.
 *
 * Робили її двоє: оператор через інтерфейс і Бітрікс через інтеграцію. Другий
 * спершу стукав по HTTP у перший — зайвий мережевий стрибок, який до того ж
 * ламався, щойно маршрут почав вимагати автентифікації.
 *
 * Тепер обидва викликають цю функцію. Правила — оплата перед відправкою,
 * причина перед скасуванням, заборона чіпати те, що вже в дорозі — живуть тут
 * і діють однаково, хто б не звертався.
 */
import { NextResponse, after } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getMaudauJwt, patchMaudauStatus } from '@/lib/maudau'
import { rozetkaToken } from '@/lib/rozetka-auth'
import { isHandedOver, requiresPayment } from '@/lib/order-statuses'
import { orderSource } from '@/lib/order-source'
import { acquireLease } from '@/lib/job-lease'
import { drainOrderEffects } from '@/lib/order-effects'
import { stageId } from '@/lib/bitrix-stages'

const MAUDAU_STATUS_MAP: Record<string, string> = {
  'Нове': 'new_order',
  'Прийнято': 'accepted',
  'Узгоджено': 'approved',
  'На доставці': 'delivering',
  'Прибуло': 'arrived',
  'Доставлено': 'completed',
  'Скасовано': 'canceled',
}


/**
 * Відмова майданчика — людською мовою.
 *
 * MauDau відповідає 422 і JSON-ом, де текст російською й у кілька шарів
 * вкладеності. Оператор бачив у картці замовлення отаке:
 *
 *   {"error_code":"VALIDATION_ERROR","error_message":"Невалидные
 *    параметри","error_details":{"status":["Нельзя перевести заказ в
 *    этот статус с текущего"]}}
 *
 * Прочитати це можна, зрозуміти, що робити далі, — ні. Двом найчастішим
 * відмовам даємо пораду, решту показуємо як є: вигадувати переклад тому,
 * чого ми не передбачили, означало б збити з пантелику впевненим тоном.
 */
export function marketplaceReason(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)

  if (/delivery_tracking_number/i.test(raw)) {
    return 'MauDau не переводить замовлення далі, поки в ньому немає ТТН. '
      + 'Спершу створіть накладну — номер піде на майданчик разом зі статусом'
  }
  if (/в этот статус с текущего|Нельзя перевести/i.test(raw)) {
    return 'MauDau не пускає замовлення з його теперішнього стану в цей. '
      + 'Перевірте, який статус стоїть на майданчику: туди вже могли перевести без нас'
  }
  return raw
}

export interface StatusChange {
  id: string
  status: string
  platform: string
  external_id: string
  actor: { id: string; name: string }
}

export async function changeOrderStatus(input: StatusChange): Promise<NextResponse> {
  const release = await acquireLease(`status:${input.id}`, 120)
  if (!release) return NextResponse.json({ success: false,
    error: 'Статус уже змінюється. Зачекайте й оновіть список' }, { status: 409 })
  try { return await changeLocked(input) } finally { await release() }
}

async function changeLocked({ id, status, actor }: StatusChange): Promise<NextResponse> {
  const supabase = createServiceClient()
  const { data: current, error: readError } = await supabase.from('orders')
    .select('status, ttn, cancel_reason, is_paid, bitrix_deal_id, platform, external_id, updated_at')
    .eq('id', id).single()
  if (readError || !current) return NextResponse.json({ success: false, error: 'Не вдалося прочитати замовлення' }, { status: 503 })
  // Derive platform/identifier from the database, never from the request body.
  const platform = current.platform as string
  const external_id = (current.external_id as string) || ''
  const { statusOptions } = await import('@/lib/order-status-options')
  if (!statusOptions(platform).includes(status)) return NextResponse.json({ success: false, error: 'Невідомий статус' }, { status: 400 })
  if (current.status === status) return NextResponse.json({ success: true, unchanged: true })
  // Cancelling is the one move that ends an order, and a cancellation with no
  // reason answers nothing later — not for the marketplace, which asks for one,
  // and not for us, where a sixth of last month's lost revenue sits under
  // "причину не вказано". The reason comes first; this route only records it.
  if (status === 'Скасовано' && !(current?.cancel_reason as string | null)?.trim()) {
    return NextResponse.json(
      {
        success: false,
        error: 'Спочатку оберіть причину скасування — вона й скасує замовлення',
      },
      { status: 400 },
    )
  }
  // Передоплата на картку приходить повз маркетплейс, тож його статуси її не
  // показують. Віддати посилку кур'єру без грошей означає дізнатись про це
  // тоді, коли повертати вже нема як.
  //
  // Правило маркетплейсне: там замовлення йдуть передоплатою. Замовлення з
  // сайту й телефону везуть з оплатою на місці, і вимагати позначки «оплачено»
  // перед доставкою означало б просити оператора збрехати.
  if (orderSource(platform) === 'marketplace' && requiresPayment(status) && !current?.is_paid) {
    return NextResponse.json(
      {
        success: false,
        error: 'Замовлення не оплачене — спершу позначте оплату',
      },
      { status: 409 },
    )
  }

  // Замок «уже в доставці» — маркетплейсний: там замовлення веде майданчик,
  // і наші зміни після передачі кур'єру нікуди б не поїхали. Замовлення з
  // сайту ми ведемо самі від початку до кінця, і «В дорозі» для нього не
  // кінець, а передостанній крок.
  if (orderSource(platform) === 'marketplace'
    && isHandedOver(current?.status as string, current?.ttn as string)) {
    return NextResponse.json(
      { success: false, error: 'Замовлення вже в доставці — статус не змінюється' },
      { status: 409 },
    )
  }

  try {
    if (platform === 'maudau') {
      const apiStatus = MAUDAU_STATUS_MAP[status]
      if (!apiStatus) throw new Error(`Unknown MauDau status: ${status}`)

      // Cancellation must go through the cancel route (needs a reason)
      if (apiStatus === 'canceled') {
        // Cancellation was confirmed through the dedicated reason route.
      }

      const numericId = external_id.replace(/^MD-/, '')
      const jwt = await getMaudauJwt()

      /*
       * Спершу ТТН, тоді статус.
       *
       * MauDau не пускає замовлення далі «Прийнято», поки в ньому немає
       * номера накладної: на спробу він відповідає 422 і
       * «delivery_tracking_number не може бути пустим». Номер у нас уже
       * є — ми створили накладну, — просто він не доїхав до майданчика.
       * Тож відправляємо його тут, а не чекаємо окремого проходу.
       */
      const ttn = (current?.ttn as string | null)?.trim()
      if (ttn && apiStatus !== 'accepted' && apiStatus !== 'new_order') {
        const { patchMaudauTtn } = await import('@/lib/maudau')
        try { await patchMaudauTtn(numericId, ttn, jwt) } catch { /* статус однаково спробуємо */ }
      }

      // MauDau requires approved before delivering
      if (apiStatus === 'delivering') {
        try { await patchMaudauStatus(numericId, 'approved', undefined, jwt) } catch { /* continue */ }
      }

      await patchMaudauStatus(numericId, apiStatus, undefined, jwt)
    } else if (orderSource(platform) === 'site') {
      // Статус замовлення з сайту — це стадія угоди. Якщо угоди немає,
      // міняти нічого: замовлення живе лише в нас
      const dealId = current?.bitrix_deal_id as number | null
      const stage = stageId(status)

      if (dealId && stage) {
        /*
         * Перевіряємо, а не віримо на слово.
         *
         * Бітрікс віддає «SQL query error!» на оновленнях, які насправді
         * проходять. Коли ми вірили помилці, статус відкочувався на
         * екрані, бланк на склад не йшов, а в самій угоді стадія вже
         * стояла нова — і склад не бачив замовлення, яке для CRM уже
         * комплектувалось.
         */
        const { updateDealChecked } = await import('@/lib/bitrix-deal')
        await updateDealChecked(dealId, { STAGE_ID: stage })
      } else if (dealId && !stage) {
        throw new Error(`Статус «${status}» не має стадії в Бітріксі`)
      }
    } else if (platform === 'rozetka') {
      const numericId = external_id.replace(/^RZ-/, '')

      const detailRes = await fetch(`${process.env.ROZETKA_BASE}/orders/${numericId}`, {
        headers: { Authorization: `Bearer ${await rozetkaToken()}` },
        signal: AbortSignal.timeout(10000),
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const detail: any = await detailRes.json()

      const statusAvailable: { child_id: number; title: string }[] =
        detail?.data?.status_available ?? detail?.content?.status_available ?? []

      const match = statusAvailable.find(s =>
        s.title?.toLowerCase().includes(status.toLowerCase()),
      )

      if (!match) {
        throw new Error('Статус недоступний для цього замовлення')
      }

      const putRes = await fetch(`${process.env.ROZETKA_BASE}/orders/${numericId}`, {
        method: 'PUT',
        signal: AbortSignal.timeout(10000),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await rozetkaToken()}`,
        },
        body: JSON.stringify({ status: match.child_id }),
      })
      if (!putRes.ok) {
        const errBody = await putRes.text().catch(() => '')
        throw new Error(`Rozetka update failed: ${putRes.status} ${errBody.slice(0, 200)}`)
      }
    }
  } catch (e) {
    return NextResponse.json(
      { success: false, error: marketplaceReason(e) },
      { status: 500 },
    )
  }

  const { data: committed, error: commitError } = await supabase.rpc('merchant_commit_status', {
    p_order_id: id, p_expected_at: current.updated_at, p_status: status, p_actor: actor,
  })
  if (commitError) return NextResponse.json({ success: false,
    error: 'Не вдалося зберегти результат. Оновіть список перед повторною спробою' }, { status: 503 })
  if (!committed) return NextResponse.json({ success: false,
    error: 'Замовлення змінилось паралельно. Оновіть список' }, { status: 409 })
  // Work is durable before responding. Cron recovers interrupted after() jobs.
  after(() => drainOrderEffects(3))
  return NextResponse.json({ success: true })
}

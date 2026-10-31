/**
 * Бланк замовлення — у чат складу.
 *
 * Склади листуються в Бітріксі, і бланк має приходити в ту саму стрічку, де
 * йде решта розмови про замовлення, а не в окремий месенджер, який треба
 * окремо відкривати.
 *
 * Поруч із посиланням стоїть номер замовлення — і більше нічого. Самого
 * посилання було замало: у стрічці вони всі однакові, і щоб зрозуміти, про
 * яке замовлення мова, доводилось відкривати кожне. Номер — те єдине, чим
 * їх розрізняють уголос, тож він і стоїть попереду.
 */
import { bitrix } from '@/lib/bitrix'
import { createServiceClient } from '@/lib/supabase/service'

/** Номер ящика в угоді — те саме поле, що заповнює й 1С */
const BOX_NUMBER_FIELD = 'UF_CRM_1607510002583'

type Service = ReturnType<typeof createServiceClient>

export interface Dialog { id: string; title: string }

/** Чати, у яких складається вебхук — з них і обирають чат складу. */
export async function visibleChats(): Promise<Dialog[]> {
  const res = await bitrix<{ items?: unknown[] } | unknown[]>('im.recent.get', {
    SKIP_OPENLINES: 'Y',
  })
  const items = (Array.isArray(res) ? res : res?.items ?? []) as {
    id: string | number; title?: string; type?: string
  }[]

  return items
    .filter(c => c.type === 'chat' && String(c.id).startsWith('chat'))
    .map(c => ({ id: String(c.id), title: c.title ?? String(c.id) }))
}

/**
 * Стадія, на якій бланк потрібен складу.
 *
 * Раніше за неї надсилати нема сенсу: замовлення з сайту ще можуть
 * скасувати або переписати, і склад збирав би те, чого вже немає.
 */
export const PICKING_STAGE = 'Комплектується'

/**
 * Чи почекати з бланком, бо номер ящика ще в дорозі.
 *
 * Номер дає огляд, і він ходить своїм проходом. Замовлення BX-201383
 * прийшло з сайту вже на комплектації: о 12:56:58 бланк пішов у чат, а
 * номер 74 з'явився о 12:57:04 — на шість секунд пізніше. Склад
 * отримав «Замовлення BX-201383» і не мав за чим шукати ящик, хоч у
 * Мерчанті номер уже стояв.
 *
 * Поки огляду не було, чекаємо: той самий прохід, що дасть номер,
 * одразу по тому догнати бланк. Коли огляд уже був, а номера немає —
 * шлемо як є: мовчання гірше за технічне ім'я.
 */
export const holdSheetForNumber = (
  box: number | null | undefined,
  autoDoneAt: string | null | undefined,
): boolean => box == null && !autoDoneAt

/**
 * Реакція на зміну статусу — одна для всіх, хто його міняє.
 *
 * Статус міняють із трьох місць: оператор у Мерчанті, оператор у Бітріксі
 * (а ми бачимо це синхронізацією) і сама CRM. Бланк має піти в усіх трьох
 * випадках, тож правило живе тут, а не в кожному з них.
 */
export async function onStatusChanged(
  service: Service,
  orderId: string,
  status: string | null,
): Promise<void> {
  if (status !== PICKING_STAGE) return

  /*
   * Два адресати однієї події.
   *
   * Складу йде бланк, клієнтові — повідомлення, що його замовлення
   * збирають. Це одна й та сама мить, і розводити її по двох місцях
   * означало б рано чи пізно надіслати одне без другого.
   *
   * Клієнта повідомляємо після складу й окремо: якщо в нього немає
   * чату або месенджер мовчить, бланк на склад має піти однаково.
   */
  await sendOrderSheet(service, orderId)

  try {
    const { notifyPicking } = await import('@/lib/customer-notify')
    await notifyPicking(service, orderId)
  } catch (e) {
    console.error('notifyPicking failed:', e instanceof Error ? e.message : e)
  }
}

export async function sendToChat(dialogId: string, text: string): Promise<void> {
  await bitrix('im.message.add', { DIALOG_ID: dialogId, MESSAGE: text })
}

/**
 * Надсилає бланк у чат складу.
 *
 * Замовлення вже прийняте, тож падати через ненайдений чат воно не має — але
 * слід лишається на самому замовленні, щоб було видно, чому в групі порожньо.
 */
export async function sendOrderSheet(
  service: Service,
  orderId: string,
): Promise<{ ok: true } | { error: string }> {
  try {
    const { data: order } = await service
      .from('orders')
      .select('warehouse, share_token, chat_sent_at, manual_number, external_id, bitrix_deal_id, auto_done_at')
      .eq('id', orderId).single()

    if (!order?.share_token) return { error: 'У замовлення немає бланка' }
    if (order.chat_sent_at) return { ok: true }
    if (!order.warehouse) return { error: 'Склад не визначено' }

    const { data: chat } = await service
      .from('warehouse_chats').select('dialog_id').eq('warehouse', order.warehouse).maybeSingle()

    if (!chat) {
      const error = `Для складу «${order.warehouse}» не вказано чат`
      await service.from('orders').update({ chat_error: error }).eq('id', orderId)
      return { error }
    }

    const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://hs-merchant.vercel.app'

    /*
     * Номер ящика, а як його ще немає — питаємо в Бітрікса.
     *
     * Бланк іде в чат тієї ж миті, коли замовлення стає на
     * комплектацію, а номер подекуди встигає з'явитись раніше в угоді,
     * ніж у нас: його ставлять у 1С. Тоді в чат летіло технічне
     * «BX-201119», склад шукав ящик за числом і не знаходив — хоч
     * варто було відкрити посилання, і номер був там.
     *
     * Тож перед надсиланням перепитуємо угоду. Технічне ім'я лишається
     * на той випадок, коли числа немає ніде: бланк у чаті потрібніший
     * за красиву назву.
     */
    let box = order.manual_number as number | null

    if (box == null && order.bitrix_deal_id) {
      try {
        const deal = await bitrix<Record<string, unknown>>(
          'crm.deal.get', { ID: order.bitrix_deal_id })
        const fromDeal = Number(deal?.[BOX_NUMBER_FIELD])
        if (Number.isFinite(fromDeal) && fromDeal > 0) {
          box = fromDeal
          // Якщо вже дізнались — хай і в нас буде, а не лише в угоді
          await service.from('orders').update({ manual_number: box }).eq('id', orderId)
        }
      } catch {
        // Мовчання Бітрікса не привід лишати склад без бланка
      }
    }

    /* Бланк без номера склад не прив'яже до ящика — краще почекати */
    if (holdSheetForNumber(box, order.auto_done_at as string | null)) {
      return { error: 'Номер ящика ще не присвоєно — бланк піде одразу після огляду' }
    }

    const number = box != null
      ? `№${box}`
      : (order.external_id as string | null) ?? ''

    await sendToChat(
      chat.dialog_id as string,
      `Замовлення ${number}: ${base}/zamovlennya/${order.share_token}`.replace('  ', ' '),
    )

    await service.from('orders')
      .update({ chat_sent_at: new Date().toISOString(), chat_error: null })
      .eq('id', orderId)

    return { ok: true }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    await service.from('orders').update({ chat_error: error }).eq('id', orderId)
    return { error }
  }
}

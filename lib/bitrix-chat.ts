/**
 * Бланк замовлення — у чат складу.
 *
 * Склади листуються в Бітріксі, і бланк має приходити в ту саму стрічку, де
 * йде решта розмови про замовлення, а не в окремий месенджер, який треба
 * окремо відкривати.
 *
 * Надсилаємо саме посилання й нічого більше: у чаті його читає людина, яка
 * вже знає, що це таке, і будь-який супровідний текст лише відсуває потрібне
 * вниз.
 */
import { bitrix } from '@/lib/bitrix'
import { createServiceClient } from '@/lib/supabase/service'

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
      .select('warehouse, share_token, chat_sent_at')
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
    await sendToChat(chat.dialog_id as string, `${base}/zamovlennya/${order.share_token}`)

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

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
  await sendOrderSheet(service, orderId)
}

export async function sendToChat(dialogId: string, text: string): Promise<void> {
  await bitrix('im.message.add', { DIALOG_ID: dialogId, MESSAGE: text })
}

/** Київський день, а не UTC: робочий день складу живе за місцевим часом */
export const kyivToday = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Kyiv' })

/** Котра зараз година у Львові */
const kyivHour = () =>
  Number(new Date().toLocaleString('en-GB', { timeZone: 'Europe/Kyiv', hour: '2-digit', hour12: false }))

/** О котрій ранку склад отримує бланки на сьогодні */
export const BLANK_HOUR = 5

/**
 * Чи час уже надсилати бланк на цю дату.
 *
 * Замовлення на п'ятницю, прийняте в середу, складу сьогодні не потрібне:
 * воно загубиться серед сьогоднішніх, а в п'ятницю вранці його ніхто не
 * шукатиме в учорашній стрічці. Тому бланк чекає до п'ятої ранку свого дня.
 */
export const blankDue = (deliveryDate: string | null | undefined): boolean => {
  if (!deliveryDate) return true
  const today = kyivToday()
  if (deliveryDate < today) return true
  if (deliveryDate > today) return false
  return kyivHour() >= BLANK_HOUR
}

/** Коли саме бланк має піти — п'ята ранку дня доставки за Києвом */
export const blankDueAt = (deliveryDate: string): Date => {
  // Зсув Києва проти UTC рахуємо на саму дату: наприкінці жовтня він
  // міняється, і зашите «+03:00» відправляло б бланк на годину раніше
  const noon = new Date(`${deliveryDate}T12:00:00Z`)
  const offset = (new Date(noon.toLocaleString('en-US', { timeZone: 'Europe/Kyiv' })).getTime()
    - new Date(noon.toLocaleString('en-US', { timeZone: 'UTC' })).getTime()) / 3_600_000
  const sign = offset >= 0 ? '+' : '-'
  const hours = String(Math.abs(offset)).padStart(2, '0')
  return new Date(
    `${deliveryDate}T${String(BLANK_HOUR).padStart(2, '0')}:00:00${sign}${hours}:00`,
  )
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
      .select('warehouse, share_token, chat_sent_at, delivery_date')
      .eq('id', orderId).single()

    if (!order?.share_token) return { error: 'У замовлення немає бланка' }
    if (order.chat_sent_at) return { ok: true }
    if (!order.warehouse) return { error: 'Склад не визначено' }

    /*
     * Замовлення на майбутній день чекає свого ранку.
     *
     * Записуємо, коли саме бланк має піти, — і тим самим кажемо людині в
     * Мерчанті, що мовчання в групі не помилка, а розклад.
     */
    const deliveryDate = order.delivery_date as string | null
    if (!blankDue(deliveryDate) && deliveryDate) {
      await service.from('orders')
        .update({ chat_due_at: blankDueAt(deliveryDate).toISOString(), chat_error: null })
        .eq('id', orderId)
      return { ok: true }
    }

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
      .update({ chat_sent_at: new Date().toISOString(), chat_due_at: null, chat_error: null })
      .eq('id', orderId)

    return { ok: true }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    await service.from('orders').update({ chat_error: error }).eq('id', orderId)
    return { error }
  }
}

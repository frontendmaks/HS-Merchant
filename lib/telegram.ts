/**
 * Бланк замовлення — у чат складу.
 *
 * Склад уже відомий з адреси, а в кожного складу свій чат, тож посилання
 * доїжджає туди саме, де замовлення збиратимуть. Надсилаємо саме посилання й
 * нічого більше: у чаті його читає людина, яка вже знає, що це таке, і будь-
 * який супровідний текст тільки відсуває потрібне вниз.
 */
import { createServiceClient } from '@/lib/supabase/service'

type Service = ReturnType<typeof createServiceClient>

export const telegramConfigured = () => !!process.env.TELEGRAM_BOT_TOKEN

async function api<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN не налаштовано')

  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  const data = await res.json().catch(() => null) as
    { ok: boolean; result?: T; description?: string } | null

  if (!data?.ok) throw new Error(data?.description ?? `Telegram відповів ${res.status}`)
  return data.result as T
}

export interface Chat { id: number; title: string; type: string }

/**
 * Чати, які бот бачить.
 *
 * Телеграм розповідає про чат лише тоді, коли в ньому щось сталося при боті —
 * додавання бота теж подія. Тому перед пошуком бота треба додати в групи, а
 * не навпаки.
 */
export async function visibleChats(): Promise<Chat[]> {
  const updates = await api<{ message?: { chat: Chat }; my_chat_member?: { chat: Chat } }[]>(
    'getUpdates', { limit: 100, allowed_updates: ['message', 'my_chat_member'] },
  )

  const seen = new Map<number, Chat>()
  for (const u of updates ?? []) {
    const chat = u.message?.chat ?? u.my_chat_member?.chat
    if (chat && chat.type !== 'private') seen.set(chat.id, chat)
  }
  return [...seen.values()]
}

export async function sendMessage(chatId: number, text: string): Promise<void> {
  await api('sendMessage', {
    chat_id: chatId,
    text,
    // Прев'ю розтягує повідомлення на пів екрана й ховає наступні
    link_preview_options: { is_disabled: true },
  })
}

/**
 * Надсилає бланк у чат складу.
 *
 * Тихо нічого не робить, якщо чат для складу не заведений: замовлення вже
 * прийняте, і падати через ненайдений чат воно не має — але слід у базі
 * лишається, щоб було видно, чому в групі порожньо.
 */
export async function sendOrderSheet(
  service: Service,
  orderId: string,
): Promise<{ ok: true } | { error: string }> {
  try {
    const { data: order } = await service
      .from('orders')
      .select('warehouse, share_token, telegram_sent_at')
      .eq('id', orderId).single()

    if (!order?.share_token) return { error: 'У замовлення немає бланка' }
    if (order.telegram_sent_at) return { ok: true }
    if (!order.warehouse) return { error: 'Склад не визначено' }

    const { data: chat } = await service
      .from('telegram_chats').select('chat_id').eq('warehouse', order.warehouse).maybeSingle()

    if (!chat) {
      const error = `Для складу «${order.warehouse}» не вказано чат`
      await service.from('orders').update({ telegram_error: error }).eq('id', orderId)
      return { error }
    }

    const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://hs-merchant.vercel.app'
    await sendMessage(Number(chat.chat_id), `${base}/zamovlennya/${order.share_token}`)

    await service.from('orders')
      .update({ telegram_sent_at: new Date().toISOString(), telegram_error: null })
      .eq('id', orderId)

    return { ok: true }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    await service.from('orders').update({ telegram_error: error }).eq('id', orderId)
    return { error }
  }
}

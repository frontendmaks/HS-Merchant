/**
 * Розмови з покупцями — в одному місці.
 *
 * Канали різні, а робота однакова: прочитати, відповісти, закрити. Тому
 * і сховище одне, а відмінності каналів живуть у тонких перехідниках
 * наприкінці файлу.
 *
 * Канал, до якого немає доступу, не вдає, що працює: він так і каже, і
 * тоді видно, що саме треба полагодити, а не чому в списку порожньо.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { phoneKey } from '@/lib/phone'

type Service = ReturnType<typeof createServiceClient>

export type Channel = 'telegram' | 'rozetka' | 'prom' | 'viber'

export const CHANNEL_LABEL: Record<Channel, string> = {
  telegram: 'Telegram',
  rozetka: 'Rozetka',
  prom: 'Prom',
  viber: 'Viber',
}

export interface Thread {
  id: string
  channel: Channel
  external_id: string
  customer_name: string | null
  customer_phone: string | null
  last_message_at: string | null
  last_message: string | null
  unread: number
  closed_at: string | null
}

export interface Message {
  id: string
  direction: 'in' | 'out'
  body: string
  author_name: string | null
  sent_at: string
  error: string | null
}

/**
 * Записує вхідне повідомлення.
 *
 * Створює розмову, якщо її ще не було: перша фраза покупця й відкриває
 * розмову, окремої дії для цього не потрібно.
 */
export async function recordIncoming(
  service: Service,
  { channel, externalId, body, name, phone, externalMessageId }: {
    channel: Channel
    externalId: string
    body: string
    name?: string | null
    phone?: string | null
    externalMessageId?: string | null
  },
): Promise<string | null> {
  const key = phoneKey(phone)

  const { data: thread } = await service
    .from('chat_threads')
    .upsert({
      channel,
      external_id: externalId,
      ...(name ? { customer_name: name } : {}),
      ...(key ? { customer_phone: key } : {}),
      last_message_at: new Date().toISOString(),
      last_message: body.slice(0, 200),
      closed_at: null,
    }, { onConflict: 'channel,external_id' })
    .select('id, unread').single()

  if (!thread) return null

  await service.from('chat_messages').insert({
    thread_id: thread.id,
    direction: 'in',
    body,
    external_id: externalMessageId ?? null,
  })

  // Лічильник непрочитаного рахуємо самі: upsert вище його не бачить
  await service.from('chat_threads')
    .update({ unread: Number(thread.unread ?? 0) + 1 })
    .eq('id', thread.id)

  return thread.id as string
}

/** Записує нашу відповідь. Надсилання — справа перехідника каналу. */
export async function recordOutgoing(
  service: Service,
  threadId: string,
  { body, authorId, authorName, error }: {
    body: string
    authorId?: string | null
    authorName?: string | null
    error?: string | null
  },
): Promise<void> {
  await service.from('chat_messages').insert({
    thread_id: threadId,
    direction: 'out',
    body,
    author_id: authorId ?? null,
    author_name: authorName ?? null,
    error: error ?? null,
  })

  if (!error) {
    await service.from('chat_threads')
      .update({ last_message_at: new Date().toISOString(), last_message: body.slice(0, 200) })
      .eq('id', threadId)
  }
}

export async function markRead(service: Service, threadId: string): Promise<void> {
  await service.from('chat_threads').update({ unread: 0 }).eq('id', threadId)
}

/**
 * Надсилає відповідь у той канал, звідки прийшла розмова.
 *
 * Канал, якого ми не вміємо, повертає пояснення, а не мовчання: оператор
 * має бачити, що його відповідь нікуди не пішла, перш ніж чекати на
 * реакцію покупця.
 */
export async function reply(
  service: Service,
  threadId: string,
  text: string,
  author: { id?: string | null; name?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  const { data: thread } = await service
    .from('chat_threads').select('channel, external_id').eq('id', threadId).maybeSingle()

  if (!thread) return { ok: false, error: 'Розмову не знайдено' }

  let error: string | null = null

  if (thread.channel === 'telegram') {
    const { sendMessage } = await import('@/lib/telegram')
    const sent = await sendMessage(service, thread.external_id as string, text)
    if (!sent.ok) error = sent.detail
  } else {
    error = `Відповідь у ${CHANNEL_LABEL[thread.channel as Channel] ?? thread.channel} `
      + 'поки недоступна — канал не під’єднано'
  }

  await recordOutgoing(service, threadId, {
    body: text, authorId: author.id, authorName: author.name, error,
  })

  return error ? { ok: false, error } : { ok: true }
}

import { redirect } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentRole, canAccess } from '@/lib/getRole'
import { CHANNEL_LABEL, type Thread, type Message, type Channel } from '@/lib/chats'
import ChatsClient from './ChatsClient'

export const dynamic = 'force-dynamic'

/**
 * Листування з покупцями.
 *
 * Канали різні, робота однакова — тож і список один, з позначкою, звідки
 * прийшло. Канал, до якого немає доступу, у списку не вдає порожнечу:
 * про нього сказано окремо.
 */
export default async function ChatsPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>
}) {
  const role = await getCurrentRole()
  if (!canAccess('chats', role)) redirect('/')

  const { id } = await searchParams
  const service = createServiceClient()

  const { data: threads } = await service
    .from('chat_threads')
    .select('id, channel, external_id, customer_name, customer_phone, last_message_at, last_message, unread, closed_at')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(100)

  const list = (threads ?? []) as unknown as Thread[]
  const picked = id && list.some(t => t.id === id) ? id : list[0]?.id ?? null

  let messages: Message[] = []
  if (picked) {
    const { data } = await service
      .from('chat_messages')
      .select('id, direction, body, author_name, sent_at, error')
      .eq('thread_id', picked)
      .order('sent_at')
      .limit(200)
    messages = (data ?? []) as unknown as Message[]
  }

  /* Канали, яких ще немає: мовчазна порожнеча читається як поломка */
  const missing: { channel: Channel; why: string }[] = []
  const { data: integrations } = await service
    .from('integrations').select('key, enabled')
  const on = new Set((integrations ?? []).filter(i => i.enabled).map(i => i.key as string))

  if (!on.has('telegram')) missing.push({ channel: 'telegram', why: 'бота не під’єднано' })
  missing.push({ channel: 'rozetka', why: 'API магазину не має доступу до листування' })
  missing.push({ channel: 'prom', why: 'магазин не під’єднано' })
  missing.push({ channel: 'viber', why: 'потрібен бізнес-акаунт Viber' })

  return (
    <div className="bg-zinc-950 text-white space-y-4">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">Листування</h1>
        <p className="text-zinc-400 text-sm mt-0.5">
          Повідомлення покупців з усіх каналів — прочитати й відповісти
        </p>
      </div>

      {missing.length > 0 && (
        <div className="text-xs text-zinc-500">
          Недоступні канали:{' '}
          {missing.map(m => `${CHANNEL_LABEL[m.channel]} (${m.why})`).join(' · ')}
        </div>
      )}

      <ChatsClient threads={list} picked={picked} messages={messages} />
    </div>
  )
}

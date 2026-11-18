/**
 * Розмови з покупцями Rozetka і Prom — у Мерчанті.
 *
 * Жоден із майданчиків не шле нам повідомлення сам, тож забираємо їх
 * опитуванням: розмови, а в розмовах — те, чого в нас ще немає. Повідомлення
 * впізнаємо за його id на майданчику, і повторний прохід нічого не дублює.
 *
 * Непрочитане рахуємо самі. Перший прохід бере його в майданчика (щоб
 * давні розмови не засвітились усі разом), далі кожне нове вхідне додає
 * одиницю, а відкрита оператором розмова обнуляє лічильник.
 */
import { createServiceClient } from '@/lib/supabase/service'
import type { Channel } from '@/lib/chats'
import {
  promChatRooms, promChatMessages, type PromChatMessage,
} from '@/lib/prom-api'
import {
  rozetkaChats, rozetkaChat, ROZETKA_SENDER_SELLER, type RozetkaChat,
} from '@/lib/rozetka-api'

type Service = ReturnType<typeof createServiceClient>

export interface ChatSyncResult {
  threads: number
  added: number
  errors: string[]
}

interface Incoming {
  externalId: string
  direction: 'in' | 'out'
  body: string
  sentAt: string
  authorName: string | null
  unread: boolean
}

/** «2026-09-04 16:29:16» київського часу → ISO в UTC */
export function kyivToIso(local: string): string {
  const [d, t = '00:00:00'] = local.trim().split(/[ T]/)
  const asUtc = new Date(`${d}T${t}Z`)
  // Скільки Київ випереджає UTC саме в цю мить — з урахуванням літнього часу
  const kyiv = new Date(asUtc.toLocaleString('en-US', { timeZone: 'Europe/Kyiv' }))
  const utc = new Date(asUtc.toLocaleString('en-US', { timeZone: 'UTC' }))
  return new Date(asUtc.getTime() - (kyiv.getTime() - utc.getTime())).toISOString()
}

/** Prom пише UTC без позначки зони */
const promToIso = (s: string) => new Date(/[zZ+]/.test(s.slice(19)) ? s : `${s}Z`).toISOString()

/**
 * Записує розмову та її нові повідомлення.
 *
 * Наша відповідь, надіслана з Мерчанту, повертається з майданчика вже як
 * його повідомлення. Її не дублюємо: шукаємо нашу вихідну з тим самим
 * текстом без id майданчика і доклеюємо їй цей id.
 */
async function store(
  service: Service,
  channel: Channel,
  thread: {
    externalId: string
    customerName: string | null
    subject: string | null
    meta: Record<string, unknown>
    orderId: string | null
    /** Непрочитане за даними майданчика — для першого знайомства з розмовою */
    unreadThere: number
  },
  messages: Incoming[],
): Promise<number> {
  const { data: existing } = await service
    .from('chat_threads')
    .select('id, unread, meta')
    .eq('channel', channel).eq('external_id', thread.externalId)
    .maybeSingle()

  const sorted = [...messages].sort((a, b) => a.sentAt.localeCompare(b.sentAt))
  const last = sorted[sorted.length - 1]

  let threadId = existing?.id as string | undefined
  if (!threadId) {
    const { data: created, error } = await service.from('chat_threads').insert({
      channel,
      external_id: thread.externalId,
      customer_name: thread.customerName,
      subject: thread.subject,
      meta: thread.meta,
      order_id: thread.orderId,
      unread: thread.unreadThere,
      last_message_at: last?.sentAt ?? null,
      last_message: last?.body.slice(0, 200) ?? null,
    }).select('id').single()
    if (error || !created) throw new Error(`розмова ${thread.externalId}: ${error?.message}`)
    threadId = created.id as string
  }

  const { data: known } = await service
    .from('chat_messages')
    .select('id, external_id, direction, body')
    .eq('thread_id', threadId)

  const seen = new Set((known ?? []).map(m => m.external_id).filter(Boolean))
  // Наші відповіді, яким майданчик ще не дав свого id
  const unclaimed = (known ?? []).filter(m => m.direction === 'out' && !m.external_id)

  let addedIn = 0
  let added = 0
  for (const m of sorted) {
    if (seen.has(m.externalId)) continue

    const mine = m.direction === 'out'
      ? unclaimed.find(u => (u.body as string).trim() === m.body.trim())
      : undefined
    if (mine) {
      await service.from('chat_messages').update({ external_id: m.externalId }).eq('id', mine.id)
      unclaimed.splice(unclaimed.indexOf(mine), 1)
      continue
    }

    const { error } = await service.from('chat_messages').insert({
      thread_id: threadId,
      direction: m.direction,
      body: m.body,
      author_name: m.authorName,
      external_id: m.externalId,
      sent_at: m.sentAt,
    })
    if (error) continue
    added++
    if (m.direction === 'in') addedIn++
  }

  // Розмова, яку ми вже знали: кожне нове вхідне — непрочитане
  const update: Record<string, unknown> = {
    customer_name: thread.customerName,
    subject: thread.subject,
    meta: { ...(existing?.meta as Record<string, unknown> ?? {}), ...thread.meta },
    ...(thread.orderId ? { order_id: thread.orderId } : {}),
  }
  if (existing && addedIn) update.unread = Number(existing.unread ?? 0) + addedIn
  if (existing && added && last) {
    update.last_message_at = last.sentAt
    update.last_message = last.body.slice(0, 200)
    if (addedIn) update.closed_at = null
  }
  await service.from('chat_threads').update(update).eq('id', threadId)

  return added
}

/* ── Prom ─────────────────────────────────────────────────────────── */

function promBody(m: PromChatMessage): string | null {
  if (m.type === 'message') return (m.body ?? '').trim() || null
  // Картка, з якої покупець почав розмову: без неї питання «а скільки
  // штук?» нема до чого прив'язати
  if (m.type === 'context' && m.context_item_id) {
    return m.context_item_type === 'order'
      ? `↪ Питання щодо замовлення №${m.context_item_id}`
      : `↪ Питання щодо товару (Prom №${m.context_item_id})`
  }
  return null
}

export async function syncPromChats(service: Service): Promise<ChatSyncResult> {
  const out: ChatSyncResult = { threads: 0, added: 0, errors: [] }
  const rooms = await promChatRooms()

  // Кімнату без нових повідомлень не перечитуємо: на кожну — окремий запит
  const { data: ours } = await service
    .from('chat_threads').select('external_id, meta').eq('channel', 'prom')
  const lastSeen = new Map((ours ?? []).map(t =>
    [t.external_id as string, (t.meta as { last_message_id?: number } | null)?.last_message_id ?? null]))

  for (const room of rooms) {
    if (lastSeen.get(room.ident) === room.last_message_id) continue
    try {
      const raw = await promChatMessages(room.ident)
      const buyer = raw.find(m => !m.is_sender && m.user_name)?.user_name ?? null
      const messages: Incoming[] = []
      for (const m of raw) {
        const body = promBody(m)
        if (!body) continue
        messages.push({
          externalId: String(m.id),
          direction: m.is_sender ? 'out' : 'in',
          body,
          sentAt: promToIso(m.date_sent),
          authorName: m.is_sender ? null : m.user_name,
          // Картка товару — службова, непрочитаним рахуємо лише написане
          unread: !m.is_sender && m.status === 'new' && m.type === 'message',
        })
      }

      // Замовлення, про яке розмова, — якщо покупець почав із нього
      const orderCtx = raw.find(m => m.type === 'context' && m.context_item_type === 'order')
      let orderId: string | null = null
      if (orderCtx?.context_item_id) {
        const { data } = await service.from('orders').select('id')
          .eq('external_id', `PR-${orderCtx.context_item_id}`).maybeSingle()
        orderId = (data?.id as string) ?? null
      }

      out.added += await store(service, 'prom', {
        externalId: room.ident,
        customerName: buyer,
        subject: null,
        meta: { room_id: room.id, last_message_id: room.last_message_id },
        orderId,
        unreadThere: messages.filter(m => m.unread && m.direction === 'in').length,
      }, messages)
      out.threads++
    } catch (e) {
      out.errors.push(`Prom ${room.ident}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return out
}

/* ── Rozetka ──────────────────────────────────────────────────────── */

export async function syncRozetkaChats(service: Service): Promise<ChatSyncResult> {
  const out: ChatSyncResult = { threads: 0, added: 0, errors: [] }
  const chats = await rozetkaChats()

  // Розмову без змін не перечитуємо: на кожну — окремий запит до Rozetka
  const { data: ours } = await service
    .from('chat_threads').select('external_id, meta').eq('channel', 'rozetka')
  const seenAt = new Map((ours ?? []).map(t =>
    [t.external_id as string, (t.meta as { updated?: string } | null)?.updated ?? null]))

  for (const chat of chats) {
    const key = String(chat.id)
    if (seenAt.get(key) === chat.updated) continue

    try {
      const full: RozetkaChat = await rozetkaChat(chat.id)
      const name = full.user?.contact_fio ?? null
      const messages: Incoming[] = (full.messages ?? [])
        .filter(m => (m.body ?? '').trim())
        .map(m => ({
          externalId: String(m.id),
          direction: m.sender === ROZETKA_SENDER_SELLER ? 'out' as const : 'in' as const,
          body: (m.body ?? '').trim(),
          sentAt: kyivToIso(m.created),
          authorName: m.sender === ROZETKA_SENDER_SELLER ? null : name,
          unread: false,
        }))

      let orderId: string | null = null
      if (full.order_id) {
        const { data } = await service.from('orders').select('id')
          .eq('external_id', `RZ-${full.order_id}`).maybeSingle()
        orderId = (data?.id as string) ?? null
      }

      out.added += await store(service, 'rozetka', {
        externalId: key,
        customerName: name,
        subject: full.subject,
        meta: { receiver_id: full.user_id, updated: chat.updated },
        orderId,
        unreadThere: Number(chat.unread_messages_count ?? 0),
      }, messages)
      out.threads++
    } catch (e) {
      out.errors.push(`Rozetka ${key}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return out
}

export async function syncMarketplaceChats(service: Service) {
  const run = async (name: string, f: () => Promise<ChatSyncResult>) => {
    try { return await f() } catch (e) {
      return { threads: 0, added: 0, errors: [`${name}: ${e instanceof Error ? e.message : String(e)}`] }
    }
  }
  const [prom, rozetka] = await Promise.all([
    run('Prom', () => syncPromChats(service)),
    run('Rozetka', () => syncRozetkaChats(service)),
  ])
  return { prom, rozetka }
}

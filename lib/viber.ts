/**
 * Viber: сповіщення клієнтові.
 *
 * Головне обмеження, через яке тут усе так влаштовано: Viber не дає
 * написати людині за номером телефону. Писати можна лише тим, хто сам
 * почав розмову з нашим публічним акаунтом — тоді Viber видає його
 * внутрішній ідентифікатор, і він у нас лишається.
 *
 * Тому робота ділиться на дві: ловити тих, хто написав, і писати тим,
 * кого вже спіймали. Номер телефону людина передає сама, кнопкою
 * «поділитись контактом», — саме за ним ми й зводимо її із замовленням.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { phoneKey } from '@/lib/phone'
import { integrationConfig } from '@/lib/integrations'

type Service = ReturnType<typeof createServiceClient>

const API = 'https://chatapi.viber.com/pa'

interface ViberConfig { token?: string }

async function call<T>(
  token: string,
  method: string,
  body: Record<string, unknown>,
): Promise<T & { status: number; status_message: string }> {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Viber-Auth-Token': token },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  return await res.json() as T & { status: number; status_message: string }
}

export interface AccountInfo {
  status: number
  status_message: string
  name?: string
  uri?: string
  subscribers_count?: number
}

/** Чи живий токен — і чий це акаунт */
export async function accountInfo(token: string): Promise<AccountInfo> {
  return await call<AccountInfo>(token, 'get_account_info', {})
}

/**
 * Куди Viber має надсилати події.
 *
 * Без цього ми не дізнаємось ні про підписку, ні про повідомлення — а
 * отже й писати не буде кому.
 */
export async function setWebhook(token: string, url: string) {
  return await call(token, 'set_webhook', {
    url,
    event_types: ['subscribed', 'unsubscribed', 'conversation_started', 'message', 'failed'],
    send_name: true,
    send_photo: true,
  })
}

export async function dropWebhook(token: string) {
  return await call(token, 'set_webhook', { url: '' })
}

/** Кого ми знаємо за цим номером */
export async function subscriberFor(
  service: Service,
  phone: string | null | undefined,
): Promise<{ viber_id: string; name: string | null } | null> {
  const key = phoneKey(phone)
  if (!key) return null

  const { data } = await service
    .from('viber_subscribers')
    .select('viber_id, name')
    .eq('phone', key)
    .is('unsubscribed_at', null)
    .order('last_seen_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()

  return (data as { viber_id: string; name: string | null } | null) ?? null
}

export type SendResult =
  | { ok: true }
  | { ok: false; reason: 'off' | 'unknown' | 'failed'; detail: string }

/**
 * Пише клієнтові й лишає слід у журналі повідомлень.
 *
 * «Не знаємо такого» — не помилка, а звичайний стан: більшість покупців
 * ніколи не писала нашому боту. Записуємо це так само, як і відправлене,
 * щоб було видно, скільком людям ми не змогли сказати нічого.
 */
export async function notifyCustomer(
  service: Service,
  { phone, text, orderId, event }: {
    phone: string | null | undefined
    text: string
    orderId?: string | null
    event?: string
  },
): Promise<SendResult> {
  const log = async (sent: boolean, error: string | null) => {
    await service.from('customer_messages').insert({
      channel: 'viber',
      order_id: orderId ?? null,
      phone: phoneKey(phone) || null,
      event: event ?? null,
      body: text,
      sent_at: sent ? new Date().toISOString() : null,
      error,
    })
  }

  const config = await integrationConfig<ViberConfig>(service, 'viber')
  if (!config?.token) {
    await log(false, 'Viber не під’єднано')
    return { ok: false, reason: 'off', detail: 'Viber не під’єднано' }
  }

  const who = await subscriberFor(service, phone)
  if (!who) {
    const detail = 'Клієнт не писав нашому акаунту — Viber не дозволяє писати першими'
    await log(false, detail)
    return { ok: false, reason: 'unknown', detail }
  }

  const answer = await call(config.token, 'send_message', {
    receiver: who.viber_id,
    type: 'text',
    text,
    sender: { name: 'Галицька Свіжина' },
  })

  if (answer.status !== 0) {
    await log(false, answer.status_message)
    return { ok: false, reason: 'failed', detail: answer.status_message }
  }

  await log(true, null)
  return { ok: true }
}

/** Запам'ятовує того, хто написав — із подій, що шле Viber */
export async function rememberSubscriber(
  service: Service,
  { id, name, avatar, phone }: {
    id: string
    name?: string | null
    avatar?: string | null
    phone?: string | null
  },
): Promise<void> {
  const key = phoneKey(phone)

  await service.from('viber_subscribers').upsert({
    viber_id: id,
    name: name ?? null,
    avatar: avatar ?? null,
    // Номер приходить лише тоді, коли людина поділилась контактом; інакше
    // не затираємо те, що вже знаємо
    ...(key ? { phone: key } : {}),
    last_seen_at: new Date().toISOString(),
    unsubscribed_at: null,
  }, { onConflict: 'viber_id' })
}

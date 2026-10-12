/**
 * Сповіщення зовнішніх систем про зміни.
 *
 * Вебхук, який не доставився, не має губити зміну — тому він спершу лягає в
 * чергу, а вже потім вирушає. Якщо Бітрікс лежить, черга дочекається; якщо
 * лежить довго — зміну все одно видно через звичайне опитування, бо курсор
 * рахується від часу оновлення замовлення, а не від надісланих вебхуків.
 */
import { createHmac } from 'node:crypto'
import { createServiceClient } from '@/lib/supabase/service'
import { buildOrders, ORDER_FIELDS } from '@/lib/integration-order'

type Service = ReturnType<typeof createServiceClient>

export type WebhookEvent =
  | 'order.created' | 'order.updated' | 'order.status_changed'
  | 'order.items_changed' | 'order.note_added' | 'order.canceled'

/** Затримки між спробами: секунда, хвилина, п'ять, півгодини, дві години. */
const BACKOFF_SEC = [1, 60, 300, 1800, 7200]

/**
 * Кладе подію в чергу кожному клієнту, який просив вебхуки.
 *
 * Виклик дешевий і не падає: якщо сповістити не вдалось, замовлення від цього
 * не має зламатись — зміна в базі вже є, і це головне.
 */
export async function notifyIntegrations(
  orderId: string,
  event: WebhookEvent,
  service: Service = createServiceClient(),
) {
  try {
    const { data: clients } = await service
      .from('integration_clients')
      .select('id')
      .eq('is_active', true)
      .not('webhook_url', 'is', null)

    if (!clients?.length) return

    const { data: order } = await service
      .from('orders').select(ORDER_FIELDS).eq('id', orderId).single()
    if (!order) return

    const [payload] = await buildOrders(service, [order])

    await service.from('integration_webhooks').insert(
      clients.map(c => ({
        client_id: c.id,
        event,
        order_id: orderId,
        payload: { event, sent_at: new Date().toISOString(), order: payload },
      })),
    )

    // Відправляємо одразу, не чекаючи крона.
    //
    // Черга потрібна для повторів, а не для затримки: інакше «вебхук летить за
    // секунди» означало б «у середньому через дві з половиною хвилини».
    // Помилка тут нічого не ламає — те, що не пішло, забере крон.
    await deliverWebhooks(service, clients.length).catch(() => {})
  } catch {
    // Мовчки: збій сповіщення не повинен валити дію, яка його спричинила
  }
}

/** Підпис, яким приймач перевіряє, що лист справді від нас і не змінений. */
export const signPayload = (secret: string, body: string) =>
  createHmac('sha256', secret).update(body).digest('hex')

/**
 * Відправляє те, що дозріло в черзі.
 *
 * @returns скільки доставлено і скільки лишилось
 */
export async function deliverWebhooks(
  service: Service = createServiceClient(),
  batch = 25,
): Promise<{ sent: number; failed: number }> {
  const { data: due } = await service
    .from('integration_webhooks')
    .select('id, client_id, event, payload, attempts')
    .eq('status', 'pending')
    .lte('next_attempt_at', new Date().toISOString())
    .order('created_at')
    .limit(batch)

  if (!due?.length) return { sent: 0, failed: 0 }

  const { data: clients } = await service
    .from('integration_clients')
    .select('id, webhook_url, webhook_secret')
    .in('id', [...new Set(due.map(d => d.client_id as string))])

  const byId = new Map((clients ?? []).map(c => [c.id as string, c]))
  let sent = 0, failed = 0

  for (const job of due) {
    const client = byId.get(job.client_id as string)
    const url = client?.webhook_url as string | undefined
    const attempts = (job.attempts as number) + 1

    if (!url) {
      await service.from('integration_webhooks')
        .update({ status: 'failed', last_error: 'Адресу вебхука не задано', attempts })
        .eq('id', job.id)
      failed++
      continue
    }

    const body = JSON.stringify(job.payload)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Merchant-Event': job.event as string,
          'X-Merchant-Delivery': job.id as string,
          ...(client?.webhook_secret
            ? { 'X-Merchant-Signature': signPayload(client.webhook_secret as string, body) }
            : {}),
        },
        body,
        signal: AbortSignal.timeout(15_000),
      })

      if (res.ok) {
        await service.from('integration_webhooks').update({
          status: 'sent', attempts, sent_at: new Date().toISOString(), last_error: null,
        }).eq('id', job.id)
        sent++
        continue
      }
      throw new Error(`HTTP ${res.status}`)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      const giveUp = attempts >= BACKOFF_SEC.length
      const wait = BACKOFF_SEC[Math.min(attempts, BACKOFF_SEC.length - 1)]

      await service.from('integration_webhooks').update({
        status: giveUp ? 'failed' : 'pending',
        attempts,
        last_error: message.slice(0, 300),
        next_attempt_at: new Date(Date.now() + wait * 1000).toISOString(),
      }).eq('id', job.id)
      failed++
    }
  }

  return { sent, failed }
}

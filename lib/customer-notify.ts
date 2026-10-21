/**
 * Повідомлення клієнтові про його замовлення.
 *
 * Пишемо тим, хто підписався на нашого бота: ні Viber, ні Telegram не
 * дають написати першими. Тим, кого не знаємо, не пишемо нічого — і
 * записуємо це окремо, щоб було видно, скільком людям ми промовчали.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { notifyCustomer as viberSend } from '@/lib/viber'
import { sendMessage as telegramSend } from '@/lib/telegram'
import { integrationConfig } from '@/lib/integrations'
import { phoneKey } from '@/lib/phone'
import { tidyAddress } from '@/lib/delivery-zones'
import { greetingName } from '@/lib/given-names'

type Service = ReturnType<typeof createServiceClient>

/** Подія, про яку повідомляємо. Одна на замовлення — більше дратує. */
export const ORDER_RECEIVED = 'order_received'

const CHANNEL_PHRASE: Record<string, string> = {
  site: 'на сайті',
  manual: 'по телефону',
  maudau: 'на маркетплейсі MauDau',
  rozetka: 'на маркетплейсі Rozetka',
}

interface OrderRow {
  id: string
  platform: string
  customer_name: string | null
  customer_phone: string | null
  address: string | null
  delivery_date: string | null
  delivery_slot: string | null
  total: number | null
  share_token: string | null
}

interface ItemRow {
  title: string
  unit: string | null
  ordered_qty: number | null
  ordered_total: number | null
}

const money = (n: number) =>
  `${Math.round(n).toLocaleString('uk-UA')} ₴`

const day = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('uk-UA', {
    day: 'numeric', month: 'long',
  })

/** Скільки позицій показуємо повністю, перш ніж згорнути решту */
const ITEMS_SHOWN = 12

export function orderReceivedText(
  order: OrderRow,
  items: ItemRow[],
  link: string | null,
): string {
  const name = greetingName(order.customer_name)
  const where = CHANNEL_PHRASE[order.platform] ?? 'у нас'

  const lines: string[] = [
    `Доброго дня, ${name}! Дякуємо за ваше замовлення ${where} в магазині «Галицька Свіжина».`,
    '',
  ]

  /*
   * Маркетплейсне замовлення везе пошта: дня доставки в ньому немає й не
   * буде. Обіцяти дату, якої ми не знаємо, гірше, ніж не називати її.
   */
  const when = order.delivery_date ? day(order.delivery_date) : null
  const slot = order.delivery_slot ? `, ${order.delivery_slot}` : ''

  /*
   * Адресу показуємо прибраною.
   *
   * Сайт лишає в ній сліди своєї форми — «м., », порожні частини, коди
   * складів. Собі ми це пробачаємо, а клієнтові показувати не варто:
   * він побачить не свою адресу, а наш технічний безлад.
   */
  const address = order.address ? tidyAddress(order.address) : null

  if (when && address) {
    lines.push(`Очікуйте замовлення ${when}${slot} за адресою: ${address}.`)
  } else if (when) {
    lines.push(`Очікуйте замовлення ${when}${slot}.`)
  } else if (address) {
    lines.push(`Доставка за адресою: ${address}.`)
  }

  if (order.total != null) lines.push(`Сума: ${money(Number(order.total))}`)

  if (items.length) {
    lines.push('', 'Ваше замовлення:')
    for (const i of items.slice(0, ITEMS_SHOWN)) {
      const qty = i.ordered_qty != null
        ? ` — ${Number(i.ordered_qty)} ${i.unit ?? 'шт'}`
        : ''
      lines.push(`• ${i.title}${qty}`)
    }
    if (items.length > ITEMS_SHOWN) {
      lines.push(`…та ще ${items.length - ITEMS_SHOWN} позицій`)
    }
  }

  lines.push('', 'Ми опрацьовуємо ваше замовлення і згодом зв’яжемося з вами.')
  if (link) lines.push('', `Деталі замовлення: ${link}`)

  return lines.join('\n')
}

export interface NotifyResult {
  looked: number
  sent: number
  unknown: number
  failed: number
  error?: string
}

/**
 * Розсилає тим, про кого ще не писали.
 *
 * Що вже надсилали, видно з журналу повідомлень, а не з позначки на
 * замовленні: журнал і так ведеться, а друге місце для того самого факту
 * рано чи пізно розійдеться з першим.
 */
export async function notifyNewOrders(
  service: Service,
  { limit = 30, hours = 24 }: { limit?: number; hours?: number } = {},
): Promise<NotifyResult> {
  const result: NotifyResult = { looked: 0, sent: 0, unknown: 0, failed: 0 }

  const viberOn = !!(await integrationConfig<{ token?: string }>(service, 'viber'))?.token
  const telegramOn = !!(await integrationConfig<{ token?: string }>(service, 'telegram'))?.token
  if (!viberOn && !telegramOn) return { ...result, error: 'Жодного месенджера не під’єднано' }

  const since = new Date(Date.now() - hours * 3600_000).toISOString()

  const { data: fresh } = await service
    .from('orders')
    .select('id, platform, customer_name, customer_phone, address, delivery_date, delivery_slot, total, share_token')
    .gte('created_at', since)
    .not('customer_phone', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit * 3)

  const orders = (fresh ?? []) as unknown as OrderRow[]
  if (!orders.length) return result

  const { data: already } = await service
    .from('customer_messages')
    .select('order_id')
    .eq('event', ORDER_RECEIVED)
    .in('order_id', orders.map(o => o.id))

  const done = new Set((already ?? []).map(r => r.order_id as string))
  const queue = orders.filter(o => !done.has(o.id)).slice(0, limit)
  result.looked = queue.length

  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://hs-merchant.vercel.app'

  for (const order of queue) {
    const { data: items } = await service
      .from('order_items')
      .select('title, unit, ordered_qty, ordered_total')
      .eq('order_id', order.id).eq('removed', false).order('position')

    const link = order.share_token ? `${base}/zamovlennya/${order.share_token}/klient` : null
    const text = orderReceivedText(order, (items ?? []) as unknown as ItemRow[], link)

    const sent = await deliver(service, order, text)
    if (sent === 'sent') result.sent++
    else if (sent === 'unknown') result.unknown++
    else result.failed++
  }

  return result
}

/**
 * Одне повідомлення — один канал.
 *
 * Telegram першим: він безкоштовний. Viber лише тоді, коли в Telegram
 * людини немає — інакше вона дістане те саме двічі й відпишеться від
 * обох.
 */
async function deliver(
  service: Service,
  order: OrderRow,
  text: string,
): Promise<'sent' | 'unknown' | 'failed'> {
  const key = phoneKey(order.customer_phone)

  if (key) {
    const { data: chat } = await service
      .from('telegram_chats')
      .select('chat_id').eq('phone', key).is('blocked_at', null)
      .order('last_seen_at', { ascending: false, nullsFirst: false })
      .limit(1).maybeSingle()

    if (chat?.chat_id) {
      const r = await telegramSend(service, chat.chat_id as string, text)
      await service.from('customer_messages').insert({
        channel: 'telegram',
        order_id: order.id,
        phone: key,
        event: ORDER_RECEIVED,
        body: text,
        sent_at: r.ok ? new Date().toISOString() : null,
        error: r.ok ? null : r.detail,
      })
      return r.ok ? 'sent' : 'failed'
    }
  }

  const viber = await viberSend(service, {
    phone: order.customer_phone,
    text,
    orderId: order.id,
    event: ORDER_RECEIVED,
  })

  if (viber.ok) return 'sent'
  return viber.reason === 'unknown' || viber.reason === 'off' ? 'unknown' : 'failed'
}

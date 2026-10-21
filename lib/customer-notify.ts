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
/** Склад узявся збирати — клієнтові варто знати, що воно рушило */
export const ORDER_PICKING = 'order_picking'
/** Перенесли на інший день — мовчати про це найгірше з усього */
export const ORDER_MOVED = 'order_moved'
/** Скасували — клієнт має почути це від нас, а не здогадатись */
export const ORDER_CANCELED = 'order_canceled'
/** Почався період доставки */
export const ORDER_ON_THE_WAY = 'order_on_the_way'
/** Період доставки скінчився — питаємо, як усе пройшло */
export const ORDER_DELIVERED = 'order_delivered'

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

/**
 * Склад почав збирати.
 *
 * Друге й останнє повідомлення в житті замовлення. Більше поки не шлемо:
 * кожне зайве — привід натиснути «блокувати», а заблокованому вже не
 * скажеш нічого.
 */
export function orderPickingText(order: OrderRow): string {
  const name = greetingName(order.customer_name)
  const when = order.delivery_date ? day(order.delivery_date) : null
  const slot = order.delivery_slot ? `, ${order.delivery_slot}` : ''

  const lines = [`${name}, ваше замовлення вже збирають.`]

  if (when) lines.push('', `Привеземо ${when}${slot}.`)
  lines.push('', 'Кур\u2019єр зателефонує перед доставкою.')

  return lines.join('\n')
}

/**
 * Пише клієнтові про початок комплектації — якщо ще не писали.
 *
 * Викликається зі зміни статусу, тож може спрацювати двічі на одне
 * замовлення: статус міняють і руками, і синхронізацією. Журнал
 * повідомлень і є тим запобіжником.
 */
export async function notifyPicking(service: Service, orderId: string): Promise<void> {
  await notifyOnce(service, orderId, ORDER_PICKING, orderPickingText)
}

export function orderMovedText(order: OrderRow, fromDate: string): string {
  const name = greetingName(order.customer_name)
  const when = order.delivery_date ? day(order.delivery_date) : null
  const slot = order.delivery_slot ? `, ${order.delivery_slot}` : ''

  const lines = [
    `${name}, ваше замовлення від ${day(fromDate)} перенесено.`,
  ]
  if (when) lines.push('', `Нова дата доставки: ${when}${slot}.`)
  lines.push('', 'Перепрошуємо за незручності. Якщо дата не підходить — зателефонуйте нам.')

  return lines.join('\n')
}

/** Скасування. Причину не переказуємо: вона наша, внутрішня. */
export function orderCanceledText(order: OrderRow): string {
  return [
    `${greetingName(order.customer_name)}, ваше замовлення скасовано.`,
    '',
    'Якщо це сталося непорозумінням — зателефонуйте нам, ми все владнаємо.',
  ].join('\n')
}

/** Період доставки почався */
export function orderOnTheWayText(order: OrderRow): string {
  const name = greetingName(order.customer_name)
  const slot = order.delivery_slot ?? null

  const lines = [`${name}, ваше замовлення вирушило до вас.`]
  if (slot) lines.push('', `Очікуйте його сьогодні в період ${slot}.`)
  lines.push('', 'Кур\u2019єр зателефонує перед приїздом.')

  return lines.join('\n')
}

/** Період скінчився — просимо оцінити */
export function orderDeliveredText(order: OrderRow, reviewLink: string | null): string {
  const lines = [
    `${greetingName(order.customer_name)}, дякуємо за замовлення!`,
    '',
    'Будемо вдячні, якщо оціните доставку — це займе пів хвилини '
      + 'і допоможе нам працювати краще.',
  ]
  if (reviewLink) lines.push('', reviewLink)
  return lines.join('\n')
}

/**
 * Надсилає одну подію по одному замовленню.
 *
 * Повторів не буває: журнал повідомлень і є запобіжником, бо кожна з цих
 * подій може спрацювати двічі — статус міняють і руками, і синхронізацією.
 */
export async function notifyOnce(
  service: Service,
  orderId: string,
  event: string,
  compose: (order: OrderRow, link: string | null) => string,
): Promise<boolean> {
  const { data: order } = await service
    .from('orders')
    .select('id, platform, customer_name, customer_phone, address, delivery_date, delivery_slot, total, share_token')
    .eq('id', orderId).maybeSingle()

  if (!order?.customer_phone) return false

  const { count } = await service
    .from('customer_messages')
    .select('id', { count: 'exact', head: true })
    .eq('order_id', orderId).eq('event', event)

  if (count) return false

  const row = order as unknown as OrderRow
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://hs-merchant.vercel.app'
  const link = row.share_token ? `${base}/vidhuk/${row.share_token}` : null

  const sent = await deliver(service, row, compose(row, link), event)
  return sent === 'sent'
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
  event: string = ORDER_RECEIVED,
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
        event,
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
    event,
  })

  if (viber.ok) return 'sent'
  return viber.reason === 'unknown' || viber.reason === 'off' ? 'unknown' : 'failed'
}

/**
 * Період доставки: вирушило й доставлено.
 *
 * Час доставки записаний як «11:00-14:00» і живе за київським годинником,
 * а сервер рахує в UTC. Зсув беремо на саму дату: наприкінці жовтня
 * годинник переводять, і зашите число помилялось би на годину — рівно в
 * той бік, щоб написати «вирушило» тоді, коли кур'єр ще на складі.
 */
const KYIV = 'Europe/Kyiv'

const kyivNow = () => {
  const now = new Date()
  const date = now.toLocaleDateString('en-CA', { timeZone: KYIV })
  const [h, m] = now.toLocaleTimeString('en-GB', {
    timeZone: KYIV, hour: '2-digit', minute: '2-digit', hour12: false,
  }).split(':').map(Number)
  return { date, minutes: h * 60 + m }
}

const slotBounds = (slot: string | null): { from: number; to: number } | null => {
  const m = (slot ?? '').match(/^(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})$/)
  if (!m) return null
  return {
    from: Number(m[1]) * 60 + Number(m[2]),
    to: Number(m[3]) * 60 + Number(m[4]),
  }
}

export interface SlotResult {
  looked: number
  onTheWay: number
  delivered: number
}

/**
 * Проходить сьогоднішні замовлення й каже те, що на часі.
 *
 * Скасовані оминаємо: сказати «вирушило» про скасоване замовлення гірше,
 * ніж не сказати нічого.
 */
export async function notifyBySlot(
  service: Service,
  { limit = 100 }: { limit?: number } = {},
): Promise<SlotResult> {
  const result: SlotResult = { looked: 0, onTheWay: 0, delivered: 0 }
  const { date, minutes } = kyivNow()

  const { data } = await service
    .from('orders')
    .select('id, delivery_slot, status, customer_phone')
    .in('platform', ['site', 'manual'])
    .eq('delivery_date', date)
    .not('customer_phone', 'is', null)
    .not('status', 'in', '("Скасовано","Повернено","Не вдалося")')
    .limit(limit)

  const orders = data ?? []
  result.looked = orders.length

  for (const order of orders) {
    const bounds = slotBounds(order.delivery_slot as string | null)
    if (!bounds) continue

    if (minutes >= bounds.to) {
      if (await notifyOnce(service, order.id as string, ORDER_DELIVERED,
        (o, link) => orderDeliveredText(o, link))) result.delivered++
      continue
    }

    if (minutes >= bounds.from) {
      if (await notifyOnce(service, order.id as string, ORDER_ON_THE_WAY,
        orderOnTheWayText)) result.onTheWay++
    }
  }

  return result
}

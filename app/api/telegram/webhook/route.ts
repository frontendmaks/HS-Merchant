import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  rememberChat, sendWelcome, sendScreen, answerCallback, sendMessage, sendPhoto,
} from '@/lib/telegram'
import { integrationConfig } from '@/lib/integrations'
import {
  MENU, CANCEL_REASONS, screenStart, screenOrders, screenNewOrder,
  screenHelp, screenCancelReasons, siteLink,
} from '@/lib/telegram-bot'
import { sitePromos } from '@/lib/site-promos'
import { getSetting } from '@/lib/settings'
import { changeOrderStatus } from '@/lib/order-status-change'
import { phoneKey } from '@/lib/phone'

type Service = ReturnType<typeof createServiceClient>

/**
 * Усе, що людина робить із ботом.
 *
 * Тут три джерела подій: команди й текст, натиснута кнопка, надісланий
 * контакт. Усі три ведуть до тих самих екранів — інакше бот поводився б
 * по-різному залежно від того, як до нього звернулись.
 */
export async function POST(request: NextRequest) {
  const update = await request.json().catch(() => null) as Update | null
  if (!update) return NextResponse.json({ ok: true })

  const service = createServiceClient()
  const config = await integrationConfig<{ token?: string }>(service, 'telegram')
  const token = config?.token
  if (!token) return NextResponse.json({ ok: true })

  try {
    if (update.callback_query) await onButton(service, token, update.callback_query)
    else if (update.my_chat_member) await onMembership(service, update.my_chat_member)
    else if (update.message) await onMessage(service, token, update.message)
  } catch (e) {
    console.error('telegram webhook:', e instanceof Error ? e.message : e)
  }

  return NextResponse.json({ ok: true })
}

interface Update {
  message?: Message
  callback_query?: CallbackQuery
  my_chat_member?: {
    chat?: { id?: number | string }
    new_chat_member?: { status?: string }
  }
}

interface Message {
  text?: string
  chat?: { id?: number | string }
  from?: { first_name?: string; last_name?: string }
  contact?: { phone_number?: string }
}

interface CallbackQuery {
  id: string
  data?: string
  message?: { chat?: { id?: number | string } }
  from?: { id?: number | string }
}

/** Телефон цього чату, якщо ми його знаємо */
async function phoneOf(service: Service, chatId: string): Promise<string | null> {
  const { data } = await service
    .from('telegram_chats').select('phone').eq('chat_id', chatId).maybeSingle()
  return (data?.phone as string | null) ?? null
}

async function onMembership(
  service: Service,
  event: NonNullable<Update['my_chat_member']>,
): Promise<void> {
  const status = event.new_chat_member?.status
  const id = event.chat?.id
  if (id == null) return

  if (status === 'kicked' || status === 'left') {
    await service.from('telegram_chats')
      .update({ blocked_at: new Date().toISOString() })
      .eq('chat_id', String(id))
  }
}

async function onMessage(service: Service, token: string, message: Message): Promise<void> {
  const chatId = message.chat?.id
  if (chatId == null) return
  const chat = String(chatId)

  const contact = message.contact?.phone_number ?? null
  const text = (message.text ?? '').trim()
  const start = text.match(/^\/start(?:\s+(\S+))?/)

  await rememberChat(service, {
    chatId: chat,
    name: [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ') || null,
    phone: contact,
    payload: start?.[1] ?? null,
  })

  const phone = await phoneOf(service, chat)

  // Чекали коментар до скасування — усе інше зачекає
  const { data: row } = await service
    .from('telegram_chats').select('pending').eq('chat_id', chat).maybeSingle()
  const pending = row?.pending as { what?: string; order?: string; reason?: string } | null

  if (pending?.what === 'cancel_comment' && text && !start) {
    await finishCancel(service, token, chat, pending, text)
    return
  }

  if (contact || start) {
    await sendWelcome(token, chat, !!phone)
    if (phone) await show(service, token, chat, await screenStart(service, null, true))
    return
  }

  await route(service, token, chat, text, phone)
}

/** Текст із меню й команди ведуть до тих самих екранів */
async function route(
  service: Service,
  token: string,
  chat: string,
  text: string,
  phone: string | null,
): Promise<void> {
  const t = text.toLowerCase()

  if (t.includes('замовити') || t.includes('нове замовлення') || t.startsWith('/new')) {
    return show(service, token, chat, await screenNewOrder(service))
  }
  if (t.includes('мої замовлення') || t.startsWith('/orders')) {
    return show(service, token, chat, await screenOrders(service, phone, { open: true }))
  }
  if (t.includes('історія') || t.startsWith('/history')) {
    return show(service, token, chat, await screenOrders(service, phone, { open: false }))
  }
  if (t.includes('акці') || t.startsWith('/promos')) {
    return showPromoCards(service, token, chat)
  }
  if (t.includes('допомог') || t.startsWith('/help')) {
    return show(service, token, chat, await screenHelp(service))
  }

  /*
   * Усе інше — питання до людини.
   *
   * Бот не вміє розмовляти, і вдавати, що зрозумів, означало б ковтати
   * звернення. Тому віддаємо його операторові й одразу кажемо про це:
   * мовчання після написаного читається як «мене проігнорували».
   */
  if (text) {
    const { recordIncoming } = await import('@/lib/chats')
    await recordIncoming(service, {
      channel: 'telegram',
      externalId: chat,
      body: text,
      phone,
    })

    await show(service, token, chat, {
      text: 'Передали ваше повідомлення операторові — він відповість тут.\n\n'
        + 'Якщо справа термінова, краще зателефонувати.',
      menu: true,
    })
  }
}

/**
 * Картки акцій — такі, як на сайті.
 *
 * Банер, назва, опис і кнопка. Сторінка акції на сайті не містить ні
 * переліку товарів, ні цін, тож вигадувати зв'язок «ця акція — ці
 * товари» ми не будемо: знижені ціни йдуть окремим списком нижче, і
 * там вони справжні.
 */
async function showPromoCards(service: Service, token: string, chat: string): Promise<void> {
  const site = await getSetting(service, 'site_url')
  const utm = await getSetting(service, 'site_utm')
  const promos = await sitePromos(service, site)

  if (!promos.length) {
    await show(service, token, chat, {
      text: 'Зараз акцій немає. Щойно з\u2019являться — ми напишемо.',
      keyboard: [[{ text: '\u{1F6D2} Замовити на сайті', url: await siteLink(service) }]],
    })
    return
  }

  for (const promo of promos.slice(0, 4)) {
    const url = `${promo.url}${utm ? `?${utm}` : ''}`
    const caption = [
      promo.title,
      promo.dates ? `Діє ${promo.dates}` : null,
      promo.items.length
        ? `${promo.items.length} ${promo.items.length === 1 ? 'товар' : 'товарів'} за акційною ціною`
        : null,
    ].filter(Boolean).join('\n')

    const buttons = [
      ...(promo.items.length
        ? [[{ text: '\u{1F4CB} Товари акції', callback_data: `sitepromo:${promo.slug}` }]]
        : []),
      [{ text: 'Детальніше на сайті', url }],
    ]

    if (promo.image) await sendPhoto(token, chat, promo.image, caption, buttons)
    else await sendScreen(token, chat, { text: caption, keyboard: buttons }, MENU)
  }
}

/** Товари однієї акції — назви, ціни й посилання */
async function showPromoItems(
  service: Service,
  token: string,
  chat: string,
  slug: string,
): Promise<void> {
  const site = await getSetting(service, 'site_url')
  const utm = await getSetting(service, 'site_utm')
  const promo = (await sitePromos(service, site)).find(p => p.slug === slug)

  if (!promo?.items.length) {
    await show(service, token, chat, { text: 'Товарів цієї акції не знайшов.', menu: true })
    return
  }

  const rows = promo.items.slice(0, 30).map(i => {
    const price = i.price != null
      ? ` — ${Math.round(i.price).toLocaleString('uk-UA')} ${i.unit ?? '₴'}`
      : ''
    return `• ${i.name}${price}`
  })

  await sendScreen(token, chat, {
    text: `\u{1F3F7} ${promo.title}\n${promo.dates ? `Діє ${promo.dates}\n` : ''}\n`
      + rows.join('\n')
      + (promo.items.length > 30 ? `\n…та ще ${promo.items.length - 30}` : ''),
    keyboard: [[{
      text: 'Усі товари акції на сайті',
      url: `${promo.url}${utm ? `?${utm}` : ''}`,
    }]],
  }, MENU)
}

async function show(
  service: Service,
  token: string,
  chat: string,
  screen: Awaited<ReturnType<typeof screenHelp>>,
): Promise<void> {
  await sendScreen(token, chat, screen, MENU)
}

async function onButton(
  service: Service,
  token: string,
  query: CallbackQuery,
): Promise<void> {
  const chat = String(query.message?.chat?.id ?? query.from?.id ?? '')
  const data = query.data ?? ''
  await answerCallback(token, query.id)
  if (!chat) return

  if (data === 'menu') {
    const phone = await phoneOf(service, chat)
    return show(service, token, chat, await screenStart(service, null, !!phone))
  }

  if (data === 'promos') return showPromoCards(service, token, chat)

  if (data.startsWith('sitepromo:')) {
    return showPromoItems(service, token, chat, data.slice('sitepromo:'.length))
  }

  if (data.startsWith('cancel:')) {
    return show(service, token, chat, screenCancelReasons(data.slice('cancel:'.length)))
  }

  if (data.startsWith('reason:')) {
    const [, orderId, code] = data.split(':')
    const reason = CANCEL_REASONS.find(r => r.code === code)
    if (!reason) return

    /*
     * Коментар питаємо до скасування, а не після.
     *
     * Після того, як замовлення вже скасоване, людині нема чого
     * дописувати: вона отримала, що хотіла, і піде. А саме цей коментар
     * і є те єдине, з чого можна щось зрозуміти.
     */
    await service.from('telegram_chats')
      .update({ pending: { what: 'cancel_comment', order: orderId, reason: reason.reason } })
      .eq('chat_id', chat)

    await sendMessage(service, chat,
      'Дякуємо. Напишіть кілька слів, що саме не так — це допоможе нам стати кращими.\n\n'
      + 'Або надішліть «-», якщо коментаря немає.')
  }
}

/** Скасовує замовлення з причиною й коментарем */
async function finishCancel(
  service: Service,
  token: string,
  chat: string,
  pending: { order?: string; reason?: string },
  comment: string,
): Promise<void> {
  await service.from('telegram_chats').update({ pending: null }).eq('chat_id', chat)

  const orderId = pending.order
  const phone = await phoneOf(service, chat)
  if (!orderId || !phone) return

  const { data: order } = await service
    .from('orders')
    .select('id, platform, external_id, customer_phone, status, customer_comment')
    .eq('id', orderId).maybeSingle()

  /*
   * Звіряємо телефон ще раз.
   *
   * Ідентифікатор замовлення міг прийти з кнопки, натиснутої ким завгодно:
   * callback_data нічого не підтверджує. Скасувати можна лише своє.
   */
  if (!order || phoneKey(order.customer_phone as string) !== phone) {
    await sendMessage(service, chat, 'Це замовлення не ваше або його вже немає.')
    return
  }

  const note = comment.trim() === '-' ? null : comment.trim().slice(0, 500)
  await service.from('orders').update({
    cancel_reason: pending.reason,
    customer_comment: note
      ? [order.customer_comment as string | null, `Скасування: ${note}`]
        .filter(Boolean).join('\n')
      : (order.customer_comment as string | null),
  }).eq('id', orderId)

  const res = await changeOrderStatus({
    id: orderId,
    status: 'Скасовано',
    platform: (order.platform as string) ?? 'site',
    external_id: (order.external_id as string) ?? '',
    actor: { id: '', name: 'Клієнт (Telegram)' },
  })

  const body = await res.json().catch(() => ({})) as { success?: boolean; error?: string }

  await sendScreen(token, chat, body.success
    ? {
        text: 'Замовлення скасовано. Дякуємо, що сказали чому — '
          + 'сподіваємось, наступного разу все буде вчасно.',
        menu: true,
      }
    : {
        text: `Не вдалося скасувати: ${body.error ?? 'спробуйте пізніше'}.\n\n`
          + 'Зателефонуйте нам, і ми все зробимо.',
        menu: true,
      }, MENU)
}

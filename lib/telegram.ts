/**
 * Telegram: той самий канал сповіщень, що й Viber.
 *
 * Обмеження те саме й з тієї ж причини: бот не може написати першим.
 * Людина має почати розмову або поділитись контактом — тоді в нас
 * з'являється її chat_id, і лише тоді ми можемо щось сказати.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { phoneKey } from '@/lib/phone'
import { integrationConfig } from '@/lib/integrations'

type Service = ReturnType<typeof createServiceClient>

const API = 'https://api.telegram.org/bot'

async function call<T>(
  token: string,
  method: string,
  body: Record<string, unknown> = {},
): Promise<{ ok: boolean; description?: string; result?: T }> {
  const res = await fetch(`${API}${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  return await res.json() as { ok: boolean; description?: string; result?: T }
}

export async function botInfo(token: string) {
  return await call<{ username?: string; first_name?: string }>(token, 'getMe')
}

export async function setWebhook(token: string, url: string) {
  return await call(token, 'setWebhook', {
    url,
    allowed_updates: ['message', 'my_chat_member'],
  })
}

export async function dropWebhook(token: string) {
  return await call(token, 'deleteWebhook', {})
}

/**
 * Вітання з проханням поділитись номером.
 *
 * Посилання з номером працює лише тоді, коли людина прийшла саме по
 * ньому. Хто відкрив бота напряму — а так роблять частіше, ніж здається —
 * лишався для нас безіменним чатом: повідомлення є, а кому воно належить,
 * невідомо.
 *
 * Кнопка «поділитись номером» закриває цю дірку, і номер при цьому
 * підтверджує сам Telegram, а не ми з чужих слів.
 */
export async function sendWelcome(token: string, chatId: string, known: boolean) {
  const text = known
    ? 'Вітаємо! Тут ви отримуватимете сповіщення про свої замовлення в «Галицькій Свіжині».'
    : 'Вітаємо в «Галицькій Свіжині»!\n\n'
      + 'Тут ви отримуватимете сповіщення про свої замовлення — коли ми їх прийняли '
      + 'і коли почали збирати.\n\n'
      + 'Щоб ми знали, які замовлення ваші, поділіться номером телефону — тим самим, '
      + 'який ви вказуєте при замовленні.'

  return await call(token, 'sendMessage', {
    chat_id: chatId,
    text,
    reply_markup: known
      ? { remove_keyboard: true }
      : {
          keyboard: [[{ text: '\u{1F4F1} Поділитись номером', request_contact: true }]],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
  })
}

export async function sendMessage(
  service: Service,
  chatId: string,
  text: string,
): Promise<{ ok: boolean; detail: string }> {
  const config = await integrationConfig<{ token?: string }>(service, 'telegram')
  if (!config?.token) return { ok: false, detail: 'Telegram не під’єднано' }

  /*
   * Без картки посилання.
   *
   * Telegram підтягує до посилання заголовок і опис сайту — у нас це
   * «Агрегатор XML фідів для маркетплейсів». Клієнтові це ні про що не
   * каже й виглядає так, ніби він отримав чужий службовий лист.
   */
  const answer = await call(config.token, 'sendMessage', {
    chat_id: chatId,
    text,
    link_preview_options: { is_disabled: true },
  })
  return { ok: answer.ok, detail: answer.description ?? 'ok' }
}

/**
 * Посилання, за яким клієнт підписується одним дотиком.
 *
 * Telegram передає боту все, що стоїть після `?start=`, — і це єдиний
 * спосіб дізнатись, хто саме натиснув. Інакше в нас був би чат без імені:
 * повідомлення є, а кому воно належить — невідомо.
 *
 * Кладемо туди номер телефону в стійкому вигляді. Нічого таємного в ньому
 * немає — людина й так свій номер знає, — але підставити чужий не вийде:
 * посилання вона отримує в бланку свого ж замовлення.
 */
export const subscribeLink = (botUsername: string, phone: string) =>
  `https://t.me/${botUsername}?start=${phoneKey(phone)}`

/** Запам'ятовує того, хто написав боту */
export async function rememberChat(
  service: Service,
  { chatId, name, phone, payload }: {
    chatId: string
    name?: string | null
    phone?: string | null
    /** Те, що стояло після /start — наш власний ключ клієнта */
    payload?: string | null
  },
): Promise<void> {
  // Контакт, яким поділились, головніший за посилання: його Telegram
  // підтвердив сам, а посилання могли переслати комусь іншому
  const key = phoneKey(phone) || phoneKey(payload)
  await service.from('telegram_chats').upsert({
    chat_id: chatId,
    name: name ?? null,
    ...(key ? { phone: key } : {}),
    last_seen_at: new Date().toISOString(),
    blocked_at: null,
  }, { onConflict: 'chat_id' })
}

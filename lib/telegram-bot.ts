/**
 * Бот для покупця: меню, замовлення, акції, скасування.
 *
 * Усе, що клієнт може зробити сам, він має робити тут, не беручи слухавку.
 * Решта — привід зателефонувати, і бот це каже прямо, замість удавати, що
 * вміє більше, ніж уміє.
 *
 * Оформлення Telegram не дає ні шрифтів, ні кольорів — у чаті є лише
 * текст, емодзі та кнопки. Тому «брендово» тут означає інше: впізнаване
 * ім'я, однаковий тон, той самий порядок кнопок і жодного службового
 * слова з нашої внутрішньої кухні.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { getSetting } from '@/lib/settings'
import { greetingName } from '@/lib/given-names'
import { CLOSED_STAGES } from '@/lib/bitrix-stages'

type Service = ReturnType<typeof createServiceClient>

export interface Button { text: string; callback_data?: string; url?: string }
export interface Screen {
  text: string
  keyboard?: Button[][]
  /** Постійні кнопки внизу — головне меню */
  menu?: boolean
}

/** Головне меню. Порядок від найчастішого до найрідшого. */
export const MENU = [
  ['\u{1F6D2} Нове замовлення', '\u{1F4E6} Мої замовлення'],
  ['\u{1F3F7} Акції', 'ℹ️ Допомога'],
]

/**
 * Причини скасування, які може назвати сам покупець.
 *
 * Наш внутрішній перелік ширший, але половина його — про нас: «немає
 * відповіді від гостя», «дубль замовлення». Пропонувати людині звинуватити
 * себе нашими словами безглуздо, тож лишаємо те, що справді буває її
 * рішенням.
 */
export const CANCEL_REASONS: { code: string; label: string; reason: string }[] = [
  { code: 'r1', label: 'Уже не актуально', reason: 'гість: відмовився (не актуально)' },
  { code: 'r2', label: 'Не влаштовує час доставки', reason: 'гість: не влаштовує час доставки' },
  { code: 'r3', label: 'Замовив не той товар', reason: 'гість: замовив не той товар' },
  { code: 'r4', label: 'Замовив в іншому місці', reason: 'гість: замовив в іншому магазині' },
  { code: 'r5', label: 'Інша причина', reason: 'гість: інша причина' },
]

const money = (n: number | null) =>
  `${Math.round(Number(n) || 0).toLocaleString('uk-UA')} ₴`

const day = (date: string | null) => date
  ? new Date(`${date}T12:00:00`).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' })
  : null

/** Замовлення, яке ще можна скасувати самому */
const CANCELLABLE = ['В обробці', 'Очікування оплати', 'ПЕРЕДЗАМОВЛЕННЯ']

interface OrderRow {
  id: string
  manual_number: number | null
  external_id: string | null
  status: string | null
  delivery_date: string | null
  delivery_slot: string | null
  address: string | null
  total: number | null
  share_token: string | null
}

async function ordersFor(
  service: Service,
  phone: string,
  { open }: { open: boolean },
): Promise<OrderRow[]> {
  let query = service
    .from('orders')
    .select('id, manual_number, external_id, status, delivery_date, delivery_slot, address, total, share_token')
    // Телефон у замовленнях записаний по-різному: «+380…», «380…», «0…».
    // Звіряємось за останніми дев'ятьма цифрами, як і всюди в Мерчанті
    .like('customer_phone', `%${phone}`)

  query = open
    ? query.not('status', 'in', `(${CLOSED_STAGES.map(s => `"${s}"`).join(',')})`)
    : query

  const { data } = await query
    .order('delivery_date', { ascending: false, nullsFirst: false })
    .limit(open ? 10 : 20)

  return (data ?? []) as unknown as OrderRow[]
}

const line = (o: OrderRow) => {
  const when = day(o.delivery_date)
  const parts = [
    o.manual_number ? `№${o.manual_number}` : (o.external_id ?? '—'),
    when ? `${when}${o.delivery_slot ? `, ${o.delivery_slot}` : ''}` : null,
    money(o.total),
    o.status,
  ].filter(Boolean)
  return parts.join(' · ')
}

export async function screenStart(name: string | null, known: boolean): Promise<Screen> {
  return {
    text: known
      ? `Вітаємо, ${greetingName(name)}! Чим допомогти?`
      : 'Вітаємо в «Галицькій Свіжині»!\n\n'
        + 'Тут ви стежитимете за своїми замовленнями — ми повідомимо, коли '
        + 'приймемо, коли почнемо збирати і коли кур’єр вирушить.\n\n'
        + 'Щоб ми знали, які замовлення ваші, поділіться номером телефону.',
    menu: true,
  }
}

export async function screenOrders(
  service: Service,
  phone: string | null,
  { open }: { open: boolean },
): Promise<Screen> {
  if (!phone) {
    return {
      text: 'Щоб показати ваші замовлення, поділіться номером телефону — '
        + 'тим самим, який ви вказуєте при замовленні.',
    }
  }

  const orders = await ordersFor(service, phone, { open })
  if (!orders.length) {
    return {
      text: open
        ? 'Зараз у вас немає активних замовлень.'
        : 'Замовлень поки немає.',
      menu: true,
    }
  }

  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://hs-merchant.vercel.app'
  const keyboard: Button[][] = []

  for (const o of orders.slice(0, 6)) {
    const row: Button[] = []
    if (o.share_token) {
      row.push({
        text: `${o.manual_number ? `№${o.manual_number}` : 'Замовлення'} — склад`,
        url: `${base}/zamovlennya/${o.share_token}/klient`,
      })
    }
    if (open && CANCELLABLE.includes(o.status ?? '')) {
      row.push({ text: 'Скасувати', callback_data: `cancel:${o.id}` })
    }
    if (row.length) keyboard.push(row)
  }

  return {
    text: (open ? '\u{1F4E6} Ваші активні замовлення:\n\n' : '\u{1F552} Ваші замовлення:\n\n')
      + orders.map(o => `• ${line(o)}`).join('\n'),
    keyboard: keyboard.length ? keyboard : undefined,
  }
}

export async function screenNewOrder(service: Service): Promise<Screen> {
  const [site, phone] = await Promise.all([
    getSetting(service, 'site_url'),
    getSetting(service, 'delivery_phone'),
  ])

  return {
    text: '\u{1F6D2} Замовити можна двома способами:\n\n'
      + `• на сайті — ${site}\n`
      + `• телефоном — ${phone}\n\n`
      + 'Доставляємо Львовом і околицями. Оплата при отриманні.',
    keyboard: [[{ text: 'Відкрити сайт', url: site }]],
  }
}

/**
 * Акції — справжні, з сайту.
 *
 * Беремо ті товари, у яких стара ціна більша за теперішню. Наші внутрішні
 * правила націнки для фідів сюди не потрапляють і не мають: вони про те,
 * як ми виглядаємо на маркетплейсі, а не про те, що покупець економить.
 */
export async function screenPromos(service: Service): Promise<Screen> {
  const site = await getSetting(service, 'site_url')

  const { data } = await service
    .from('products')
    .select('name, slug, price, price_old')
    .not('price_old', 'is', null)
    .gt('price_old', 0)
    .order('price_old', { ascending: false })
    .limit(60)

  const onSale = (data ?? [])
    .filter(p => Number(p.price_old) > Number(p.price))
    .slice(0, 10)

  if (!onSale.length) {
    return {
      text: 'Зараз акцій немає. Щойно з’являться — ми напишемо.',
      keyboard: [[{ text: 'Дивитись каталог', url: site }]],
    }
  }

  const rows = onSale.map(p => {
    const off = Math.round((1 - Number(p.price) / Number(p.price_old)) * 100)
    return `• ${p.name}\n   ${money(Number(p.price))} замість ${money(Number(p.price_old))}`
      + (off > 0 ? `  −${off}%` : '')
  })

  return {
    text: `\u{1F3F7} Акції тижня:\n\n${rows.join('\n')}`,
    keyboard: [[{ text: 'Усі акції на сайті', url: `${site}/katalog-nashoyi-produkcziyi/` }]],
  }
}

export async function screenHelp(service: Service): Promise<Screen> {
  const phone = await getSetting(service, 'delivery_phone')

  return {
    text: 'ℹ️ Що вміє цей бот:\n\n'
      + '/start — головне меню\n'
      + '/orders — активні замовлення, тут же можна скасувати\n'
      + '/history — усі ваші замовлення\n'
      + '/new — як зробити нове замовлення\n'
      + '/promos — акції\n\n'
      + `Якщо потрібна людина — телефонуйте: ${phone}`,
    menu: true,
  }
}

export function screenCancelReasons(orderId: string): Screen {
  return {
    text: 'Чому скасовуємо замовлення?',
    keyboard: [
      ...CANCEL_REASONS.map(r => [{
        text: r.label,
        callback_data: `reason:${orderId}:${r.code}`,
      }]),
      [{ text: '← Передумав', callback_data: 'menu' }],
    ],
  }
}

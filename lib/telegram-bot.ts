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

/**
 * Скільки днів замовлення лишається «активним».
 *
 * Те, що мало приїхати тиждень тому й досі висить у роботі, — наша
 * недоробка, а не його очікування. Показувати таке покупцеві означає
 * щодня нагадувати йому про борг, якого він не питав.
 */
const ACTIVE_DAYS = 3

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

  if (open) {
    const since = new Date(Date.now() - ACTIVE_DAYS * 86_400_000)
      .toISOString().slice(0, 10)
    query = query
      .not('status', 'in', `(${CLOSED_STAGES.map(s => `"${s}"`).join(',')})`)
      .gte('delivery_date', since)
  }

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

/** Сайт із міткою — щоб у статистиці було видно, кого привів бот */
export async function siteLink(service: Service): Promise<string> {
  const [site, utm] = await Promise.all([
    getSetting(service, 'site_url'),
    getSetting(service, 'site_utm'),
  ])
  if (!utm) return site
  return `${site}${site.includes('?') ? '&' : '?'}${utm}`
}

export async function screenNewOrder(service: Service): Promise<Screen> {
  const [link, phone] = await Promise.all([
    siteLink(service),
    getSetting(service, 'delivery_phone'),
  ])

  return {
    text: 'Доставка від «Галицької Свіжини»\n\n'
      + '\u{1F6D2} Замовити можна такими способами:\n'
      + `• на сайті — ${link}\n`
      + `• через дзвінок — ${phone}\n\n`
      + 'Швидка доставка по Львову та околицях. Вартість доставки 1 грн '
      + '(при оформленні замовлення на суму 1000 грн).\n\n'
      + 'Широка лінія якісного та свіжого асортименту. Стабільні та '
      + 'конкурентні цінові пропозиції для усіх наших клієнтів.',
    keyboard: [[{ text: 'Відкрити сайт', url: link }]],
  }
}

/**
 * Акції — справжні, з сайту.
 *
 * Беремо товари, у яких стара ціна більша за теперішню. Наші внутрішні
 * правила націнки для фідів сюди не потрапляють і не мають: вони про те,
 * як ми виглядаємо на маркетплейсі, а не про те, що економить покупець.
 *
 * Групуємо за категорією: «ковбаса дешевша на 24%» — це новина, а список
 * із двадцяти дев'яти позицій поспіль — ні, його ніхто не дочитає.
 */
export interface Promo {
  category: string
  items: { name: string; slug: string | null; price: number; old: number }[]
  maxOff: number
}

export async function loadPromos(service: Service): Promise<Promo[]> {
  const { data } = await service
    .from('products')
    .select('name, slug, price, price_old, category_name')
    .not('price_old', 'is', null)
    .gt('price_old', 0)
    .limit(500)

  const byCategory = new Map<string, Promo>()

  for (const p of data ?? []) {
    const price = Number(p.price)
    const old = Number(p.price_old)
    if (!(old > price) || !(price > 0)) continue

    const category = (p.category_name as string) || 'Інше'
    const promo = byCategory.get(category) ?? { category, items: [], maxOff: 0 }
    promo.items.push({
      name: p.name as string,
      slug: (p.slug as string | null) ?? null,
      price,
      old,
    })
    promo.maxOff = Math.max(promo.maxOff, Math.round((1 - price / old) * 100))
    byCategory.set(category, promo)
  }

  // Найбільша знижка нагорі: саме її й шукають, відкриваючи акції
  return [...byCategory.values()].sort((a, b) => b.maxOff - a.maxOff)
}

export async function screenPromos(service: Service): Promise<Screen> {
  const link = await siteLink(service)
  const promos = await loadPromos(service)

  if (!promos.length) {
    return {
      text: 'Зараз акцій немає. Щойно з\u2019являться — ми напишемо.',
      keyboard: [[{ text: 'Дивитись каталог', url: link }]],
    }
  }

  const total = promos.reduce((n, p) => n + p.items.length, 0)

  return {
    text: `\u{1F3F7} Акції — ${total} ${total === 1 ? 'позиція' : 'позицій'} `
      + `у ${promos.length} категоріях.\n\nОберіть, що подивитись:`,
    keyboard: [
      ...promos.slice(0, 12).map((p, i) => [{
        text: `${p.category} · ${p.items.length} · до −${p.maxOff}%`,
        callback_data: `promo:${i}`,
      }]),
      [{ text: 'Усі товари на сайті', url: link }],
    ],
  }
}

/** Одна акція: позиції, ціни й посилання на кожну */
export async function screenPromo(service: Service, index: number): Promise<Screen> {
  const promos = await loadPromos(service)
  const promo = promos[index]
  if (!promo) return screenPromos(service)

  const site = await getSetting(service, 'site_url')
  const utm = await getSetting(service, 'site_utm')
  const url = (slug: string) => `${site}/${slug}/${utm ? `?${utm}` : ''}`

  const rows = promo.items.map(i => {
    const off = Math.round((1 - i.price / i.old) * 100)
    return `• ${i.name}\n   ${money(i.price)} замість ${money(i.old)}`
      + (off > 0 ? `  −${off}%` : '')
  })

  return {
    text: `\u{1F3F7} ${promo.category}\n\n${rows.join('\n')}`,
    keyboard: [
      ...promo.items.slice(0, 8)
        .filter(i => i.slug)
        .map(i => [{ text: i.name.slice(0, 60), url: url(i.slug as string) }]),
      [{ text: '\u2190 Усі акції', callback_data: 'promos' }],
    ],
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
      + `Якщо потрібна допомога — телефонуйте: ${phone}`,
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

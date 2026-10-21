/**
 * Доповнення карток у списку «Нові замовлення».
 *
 * Картку створює чинна інтеграція, і в ній є все, крім двох речей, без
 * яких складу незручно: номера ящика й бланка. Номер живе в журналі, бланк
 * — у Мерчанті, і ні того, ні того та інтеграція не знає.
 *
 * Тому ми картки не створюємо й не пересуваємо, а лише дописуємо. Усе, що
 * ми додали, живе в окремому блоці наприкінці опису, відбитому міткою:
 * так його можна переписати начисто, не чіпаючи того, що написала
 * інтеграція чи людина.
 */
import { createServiceClient } from '@/lib/supabase/service'
import {
  listCards, updateCard, boardLists, trelloConfigured, type TrelloCard,
} from '@/lib/trello'
import { getSetting } from '@/lib/settings'
import { phoneKey } from '@/lib/phone'

type Service = ReturnType<typeof createServiceClient>

const MARK = '— — — Мерчант — — —'

export interface CardResult {
  looked: number
  numbered: number
  linked: number
  moved: number
  unmatched: { card: string; why: string }[]
  problems: { card: string; number: number | null; issues: string[] }[]
  error?: string
}

/** «Дата доставки **21.10.2026**» → 2026-10-21 */
function dateFromDesc(desc: string): string | null {
  const m = desc.match(/Дата доставки\s*\*{0,2}(\d{2})\.(\d{2})\.(\d{4})/u)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

/** Усі телефони, що трапляються в картці, у вигляді ключів */
function phonesIn(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(/(?:\+?38)?0\d{9}/g)) {
    const key = phoneKey(m[0])
    if (key) out.add(key)
  }
  return [...out]
}

/**
 * Адреса у вигляді, придатному для звіряння.
 *
 * Сайт, Бітрікс і картка пишуть ту саму адресу по-різному: «вулиця» і
 * «вул.», «буд. №» і просто число, кома то є, то немає. Лишаємо самі
 * літери й цифри в нижньому регістрі — решта в адресі не несе змісту.
 */
function addressKey(raw: string | null | undefined): string {
  return (raw ?? '')
    .toLowerCase()
    // Межі слова тут через \p{L}, а не \b: ASCII-межа між двома
    // кириличними літерами не спрацьовує, і правило мовчки нічого не робить
    .replace(
      /(?<![\p{L}])(вулиця|вул|проспект|просп|провулок|пров|будинок|буд|місто|м|село|с)(?![\p{L}])\.?/gu,
      ' ',
    )
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

const NUMBER_AT_START = /^\s*№\s*\d+/u

/** Коротша адреса як ключ ненадійна — надто легко трапляється підрядком */
const MIN_ADDRESS_KEY = 14

/** Те, що ми дописали минулого разу, прибираємо — блок перепишеться начисто */
const stripOurs = (desc: string) => desc.split(MARK)[0].trimEnd()

interface OrderRow {
  id: string
  platform: string
  manual_number: number | null
  delivery_date: string | null
  delivery_slot: string | null
  address: string | null
  customer_name: string | null
  customer_phone: string | null
  warehouse: string | null
  share_token: string | null
  status: string | null
}

/**
 * Чого в картці бракує, щоб склад міг за нею працювати.
 *
 * Перевіряємо не картку саму по собі, а те, чи сходиться вона із
 * замовленням: картка з правильними полями, але чужою адресою — гірша за
 * картку з порожньою адресою, бо виглядає справною.
 */
const isMarketplace = (o: OrderRow) => o.platform === 'maudau' || o.platform === 'rozetka'

function issuesOf(card: TrelloCard, order: OrderRow): string[] {
  const out: string[] = []
  const text = `${card.name}\n${card.desc}`

  // Маркетплейсне замовлення везе пошта: ні дня доставки, ні періоду,
  // ні ящика в ньому немає й не має бути — вимагати їх було б вигадкою
  if (!isMarketplace(order)) {
    const cardDate = dateFromDesc(card.desc)
    if (!cardDate) out.push('у картці немає дати доставки')
    else if (order.delivery_date && cardDate !== order.delivery_date) {
      out.push(`дата в картці ${cardDate}, у замовленні ${order.delivery_date}`)
    }

    if (!/Період доставки\s*\*{0,2}\d{1,2}[:.]\d{2}/u.test(card.desc)) {
      out.push('у картці немає періоду доставки')
    }

    if (!order.warehouse) out.push('у замовленні не визначено склад')
    if (!order.delivery_slot) out.push('у замовленні не вказано період')
  }

  if (!order.address?.trim()) out.push('у замовленні немає адреси')

  if (/Клієнт:?\s*\*{0,2}Не вказано/iu.test(text)) out.push('у картці не вказано клієнта')

  const phones = phonesIn(text)
  if (!phones.length) {
    out.push(order.customer_phone
      ? `у картці немає телефону, у замовленні ${order.customer_phone}`
      : 'ні в картці, ні в замовленні немає телефону')
  } else if (order.customer_phone && !phones.includes(phoneKey(order.customer_phone))) {
    out.push('телефон у картці не збігається із замовленням')
  }

  return out
}

/** Блок, який дописуємо від себе */
function ourBlock(order: OrderRow, issues: string[]): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://hs-merchant.vercel.app'
  const lines = [
    MARK,
    order.share_token ? `Бланк: ${base}/zamovlennya/${order.share_token}` : 'Бланк ще не створено',
  ]
  if (order.warehouse) lines.push(`Склад: ${order.warehouse}`)
  if (isMarketplace(order)) {
    lines.push(`Маркетплейс: ${order.platform === 'maudau' ? 'MauDau' : 'Rozetka'} — везе пошта, ящика немає`)
  }
  if (issues.length) lines.push('', '⚠️ Перевірити:', ...issues.map(i => `• ${i}`))
  return lines.join('\n')
}

export async function enrichNewCards(
  service: Service,
  { limit = 40, orderIds }: { limit?: number; orderIds?: string[] } = {},
): Promise<CardResult> {
  const result: CardResult = {
    looked: 0, numbered: 0, linked: 0, moved: 0, unmatched: [], problems: [],
  }

  if (!trelloConfigured()) return { ...result, error: 'TRELLO_KEY/TRELLO_TOKEN не налаштовано' }
  if (!await getSetting(service, 'trello_enrich')) return { ...result, error: 'Вимкнено' }

  try {
    const listId = await getSetting(service, 'trello_new_list')
    const marketList = await getSetting(service, 'trello_marketplace_list')
    const board = await getSetting(service, 'trello_board')
    const matched: { card: TrelloCard; order: OrderRow }[] = []
    const cards = (await listCards(listId)).slice(0, limit)
    result.looked = cards.length
    if (!cards.length) return result

    /*
     * Замовлення беремо одним запитом на всі картки.
     *
     * Вікно — два тижні навколо сьогодні: картка в «Нових» може стосуватись
     * і завтрашньої доставки, і вчорашньої, яку не встигли рушити далі.
     */
    const day = (shift: number) =>
      new Date(Date.now() + shift * 86_400_000).toISOString().slice(0, 10)

    const COLUMNS = 'id, platform, manual_number, delivery_date, delivery_slot, address, customer_name, customer_phone, warehouse, share_token, status'

    /*
     * Маркетплейсні замовлення теж потрапляють у цей список.
     *
     * У них немає ні дня доставки, ні періоду, ні номера ящика — їх везе
     * пошта, а не наш кур'єр. Тому й шукаємо їх за датою замовлення, а не
     * за датою доставки, якої в них просто немає.
     */
    const [{ data: ours }, { data: markets }] = await Promise.all([
      service.from('orders').select(COLUMNS)
        .in('platform', ['site', 'manual'])
        .gte('delivery_date', day(-10)).lte('delivery_date', day(4)),
      service.from('orders').select(COLUMNS)
        .in('platform', ['maudau', 'rozetka'])
        .gte('order_date', day(-14)).lte('order_date', day(1)),
    ])

    const all = [...(ours ?? []), ...(markets ?? [])] as unknown as OrderRow[]

    /*
     * Коли нас покликали через конкретні замовлення, рештою не займаємось.
     *
     * Так виклик після огляду коштує один запит до Trello замість сорока,
     * і картка переїжджає за секунди, а не за три хвилини до наступного
     * проходу.
     */
    const orders = orderIds?.length ? all.filter(o => orderIds.includes(o.id)) : all

    // Ключ — телефон і день: одна людина за тиждень замовляє двічі, і без
    // дня картка причепилась би до чужої доставки
    const byPhoneDay = new Map<string, OrderRow>()
    for (const o of orders) {
      const key = phoneKey(o.customer_phone)
      if (key && o.delivery_date) byPhoneDay.set(`${key}|${o.delivery_date}`, o)
    }

    /*
     * Запасний ключ — адреса.
     *
     * Частина карток приходить без телефону й без клієнта: інтеграція
     * створила їх, коли в угоді ще нічого не було. Телефон у них уже не
     * з'явиться, а зчепити їх якось треба — лишається адреса.
     *
     * Беремо її лише тоді, коли вона веде рівно до одного замовлення.
     * Два замовлення на одну адресу — це або та сама людина двічі, або
     * сусіди, і вгадувати між ними означало б дати комусь чужий ящик.
     */
    const byAddress = new Map<string, OrderRow[]>()
    for (const o of orders) {
      const key = addressKey(o.address)
      // Короткі ключі не беремо: «львів» трапляється підрядком у десятку
      // чужих карток, і картка діставала б чужий номер
      if (key.length >= MIN_ADDRESS_KEY) {
        byAddress.set(key, [...(byAddress.get(key) ?? []), o])
      }
    }

    const soleByAddress = (cardText: string, date: string | null): OrderRow | null => {
      // Збираємо всі збіги, а не перший-ліпший: кілька різних адрес у
      // тексті однієї картки означають, що ми не знаємо, котра з них її
      const hits: OrderRow[] = []
      for (const [key, found] of byAddress) {
        if (!cardText.includes(key)) continue
        hits.push(...(date ? found.filter(o => o.delivery_date === date) : found))
      }

      const distinct = new Map(hits.map(o => [o.id, o]))
      return distinct.size === 1 ? [...distinct.values()][0] : null
    }

    for (const card of cards) {
      const text = `${card.name}\n${card.desc}`
      const date = dateFromDesc(card.desc)
      const phones = phonesIn(text)

      const order = (date
        ? phones.map(p => byPhoneDay.get(`${p}|${date}`)).find(Boolean)
        : undefined)
        ?? soleByAddress(addressKey(card.name + ' ' + card.desc), date)

      if (!order) {
        result.unmatched.push({
          card: card.name.slice(0, 60),
          why: phones.length
            ? `замовлення на ${date ?? 'цю дату'} за цим телефоном не знайдено`
            : 'ні телефону, ні єдиного замовлення за адресою',
        })
        continue
      }

      const issues = issuesOf(card, order)
      if (issues.length) {
        result.problems.push({ card: card.name.slice(0, 60), number: order.manual_number, issues })
      }

      const fields: { name?: string; desc?: string; idList?: string } = {}

      /*
       * Маркетплейсне замовлення відкладаємо в окремий список.
       *
       * Серед карток кур'єрської доставки воно збиває з пантелику: у ньому
       * немає ні дня, ні періоду, ні ящика, і виглядає воно як недороблене.
       * Насправді його просто везе пошта — і краще, щоб це було видно з
       * того, де картка лежить, а не з дрібного підпису в описі.
       */
      if (isMarketplace(order) && marketList && card.idList !== marketList) {
        fields.idList = marketList
      }

      // Номер ящика попереду назви — склад шукає картку саме за ним
      if (order.manual_number != null && !NUMBER_AT_START.test(card.name)) {
        fields.name = `№${order.manual_number} ${card.name}`.slice(0, 16_384)
      }

      const desc = `${stripOurs(card.desc)}\n\n${ourBlock(order, issues)}`
      if (desc.trim() !== card.desc.trim()) fields.desc = desc


      if (Object.keys(fields).length) {
        await updateCard(card.id, fields)
        if (fields.name) result.numbered++
        if (fields.desc) result.linked++
        if (fields.idList) result.moved++
      }

      // Маркетплейсні вже переїхали у свій список — їх не розкладаємо
      if (!fields.idList) matched.push({ card, order })
    }

    /*
     * Розкладання — після дописування.
     *
     * Номер і бланк мають бути в картці до того, як вона поїде на склад:
     * комірник відкриває її вже там, і картка без номера для нього
     * безіменна.
     */
    const spread = await spreadToPicking(service, matched, board)
    result.moved += spread.moved
    result.problems.push(...spread.problems.map(p => ({
      card: p.card, number: null, issues: [p.why],
    })))

    return result
  } catch (e) {
    return { ...result, error: e instanceof Error ? e.message : 'помилка Trello' }
  }
}

/**
 * Розкладання карток по складах і періодах.
 *
 * На дошці в кожного складу свій список комплектації, а всередині —
 * картки-роздільники «11-14», «14-17», «17-20». Комірник читає список
 * згори вниз і збирає те, що стоїть під потрібною годиною, тож картка
 * має лягти саме під свій роздільник, а не в кінець списку.
 *
 * Назви складів у нас і на дошці не збігаються дослівно: «МЕ ЦУМ онлайн»
 * проти «ЦУМ комплектується». Зводимо їх, прибираючи те, що нічого не
 * розрізняє, — «МЕ», «онлайн», «комплектується», дефіси й пробіли.
 */
const stripNoise = (s: string) => s
  .toLowerCase()
  // Межі слова через \p{L}, а не \b: ASCII-межа між кириличними літерами
  // не спрацьовує, і «МЕ» лишалось у назві — «мецум» не збігався з «цум»
  .replace(/(?<![\p{L}])ме(?![\p{L}])/gu, ' ')
  .replace(/онлайн|комплектується|комплектация/g, ' ')
  .replace(/[^\p{L}\p{N}]+/gu, '')

/**
 * Склади, які збирають не зі свого списку.
 *
 * «МЕ ТТ Іскра» власного списку на дошці не має й не потребує: ці
 * замовлення збирає АС-2. Без цього запису картка зависала б у «Нових».
 */
const ALIAS: Record<string, string> = {
  ттіскра: 'ас2',
}

/** «11:00-14:00» → «1114»: так само виглядає й назва роздільника */
const slotKey = (slot: string) => slot.replace(/[^\d]/g, '').replace(/00/g, '')

interface Destination {
  listId: string
  /** Роздільник періоду: під нього й кладемо */
  separators: Map<string, { id: string; pos: number }>
  cards: TrelloCard[]
}

async function pickingLists(boardId: string): Promise<Map<string, Destination>> {
  const lists = await boardLists(boardId)
  const out = new Map<string, Destination>()

  for (const list of lists) {
    if (!/комплект/i.test(list.name)) continue

    const cards = await listCards(list.id)
    const separators = new Map<string, { id: string; pos: number }>()

    for (const card of cards) {
      const key = slotKey(card.name)
      // Роздільник — коротка картка, у назві якої лише години
      if (card.name.trim().length <= 8 && /^\d{2}-\d{2}$/.test(card.name.trim())) {
        separators.set(key, { id: card.id, pos: card.pos })
      }
    }

    if (separators.size) out.set(stripNoise(list.name), { listId: list.id, separators, cards })
  }

  return out
}

/**
 * Куди саме покласти картку всередині списку.
 *
 * Між роздільником і тим, що стоїть одразу за ним. Нове замовлення так
 * опиняється першим у своєму періоді — комірник бачить його відразу, а
 * не домотує до кінця дня.
 */
function positionUnder(dest: Destination, separator: { pos: number }): number {
  const after = dest.cards
    .filter(c => c.pos > separator.pos)
    .sort((a, b) => a.pos - b.pos)[0]

  return after ? (separator.pos + after.pos) / 2 : separator.pos + 1000
}

export interface SpreadResult {
  moved: number
  problems: { card: string; why: string }[]
}

export async function spreadToPicking(
  service: Service,
  cards: { card: TrelloCard; order: OrderRow }[],
  boardId: string,
): Promise<SpreadResult> {
  const result: SpreadResult = { moved: 0, problems: [] }
  const ready = cards.filter(({ order }) =>
    order.warehouse && order.delivery_slot && !isMarketplace(order)
    && order.status !== 'Скасовано')

  if (!ready.length) return result

  const lists = await pickingLists(boardId)

  for (const { card, order } of ready) {
    const key = stripNoise(order.warehouse as string)
    const dest = lists.get(ALIAS[key] ?? key)
    if (!dest) {
      result.problems.push({
        card: card.name.slice(0, 50),
        why: `на дошці немає списку для складу «${order.warehouse}»`,
      })
      continue
    }

    const separator = dest.separators.get(slotKey(order.delivery_slot as string))
    if (!separator) {
      result.problems.push({
        card: card.name.slice(0, 50),
        why: `у списку немає періоду ${order.delivery_slot}`,
      })
      continue
    }

    const pos = positionUnder(dest, separator)
    await updateCard(card.id, { idList: dest.listId, pos })

    // Наступну картку цього ж періоду кладемо вже з урахуванням цієї
    dest.cards.push({ ...card, idList: dest.listId, pos })
    result.moved++
  }

  return result
}

/**
 * Скасоване замовлення на дошці.
 *
 * Картка, що лишилась серед робочих, — це ящик, який хтось таки збере.
 * Тому кладемо її в «Не доставлено»: там її видно, і при розборі дня
 * зрозуміло, чому замовлення не поїхало. Якщо такого списку немає —
 * ховаємо в архів, бо лишати на видноті гірше.
 */
export async function cardCanceled(
  service: Service,
  orderId: string,
): Promise<{ ok: boolean; note?: string }> {
  if (!trelloConfigured()) return { ok: false, note: 'Trello не налаштовано' }

  try {
    const { data: order } = await service
      .from('orders')
      .select('manual_number, customer_phone, delivery_date, address')
      .eq('id', orderId).maybeSingle()

    if (!order) return { ok: false, note: 'Замовлення не знайдено' }

    const board = await getSetting(service, 'trello_board')
    const lists = await boardLists(board)

    const failed = lists.find(l => /не\s*достав/i.test(l.name))
    const phone = phoneKey(order.customer_phone as string | null)
    const number = order.manual_number != null ? `№${order.manual_number}` : null

    /*
     * Шукаємо картку по всіх робочих списках, а не лише в «Нових»:
     * скасувати можуть і те, що вже поїхало на склад.
     */
    for (const list of lists) {
      if (failed && list.id === failed.id) continue
      if (/достав|архів/i.test(list.name) && list.id !== failed?.id) continue

      const cards = await listCards(list.id)
      const found = cards.find(c => {
        const text = `${c.name}\n${c.desc}`
        if (number && c.name.trim().startsWith(number)) return true
        return !!phone && phonesIn(text).includes(phone)
          && (!order.address || addressKey(text).includes(addressKey(order.address as string)))
      })

      if (!found) continue

      await updateCard(found.id, failed
        ? { idList: failed.id }
        : { closed: true })

      return { ok: true, note: failed ? `у «${failed.name}»` : 'в архів' }
    }

    return { ok: false, note: 'картку на дошці не знайшов' }
  } catch (e) {
    return { ok: false, note: e instanceof Error ? e.message : 'помилка Trello' }
  }
}

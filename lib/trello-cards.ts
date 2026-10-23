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
import { slotStartMinutes } from '@/lib/bitrix-slots'
import { kyivToday, kyivMinutesNow } from '@/lib/delivery-slots'

type Service = ReturnType<typeof createServiceClient>

const MARK = '— — — Мерчант — — —'

/** Усе, що потрібно, аби зіставити картку із замовленням і дописати її */
const COLUMNS = 'id, platform, manual_number, delivery_date, delivery_slot, address, customer_name, customer_phone, warehouse, share_token, status, trello_card_id'

export interface CardResult {
  looked: number
  numbered: number
  linked: number
  moved: number
  /** Скільки карток чекає свого вечора в «Нових замовленнях» */
  waiting: number
  unmatched: { card: string; why: string }[]
  problems: { card: string; number: number | null; issues: string[] }[]
  error?: string
}

/** «Дата доставки **21.10.2026**» → 2026-10-21 */
function dateFromDesc(desc: string): string | null {
  const m = desc.match(/Дата доставки\s*\*{0,2}(\d{2})\.(\d{2})\.(\d{4})/u)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

/** «Період доставки **17:00-20:00**» → «17:00-20:00» */
function slotInDesc(desc: string): string | null {
  const m = desc.match(/Період доставки\s*\*{0,2}\s*(\d{1,2}[:.]\d{2}\s*[-–—]\s*\d{1,2}[:.]\d{2})/u)
  return m ? m[1] : null
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
  trello_card_id: string | null
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

    const cardSlot = slotInDesc(card.desc)
    if (!cardSlot) {
      out.push('у картці немає періоду доставки')
    } else if (order.delivery_slot
      && slotKey(cardSlot) !== slotKey(order.delivery_slot)) {
      /*
       * Період у картці й у замовленні мають збігатись.
       *
       * Везе кур'єр за карткою, а правлять замовлення в Мерчанті — і
       * якщо вони розійшлись, хтось приїде не в ту годину. Розкладаємо
       * картку за періодом замовлення (він із угоди, і він головний), а
       * про розбіжність кажемо вголос.
       */
      out.push(`період у картці ${cardSlot}, у замовленні ${order.delivery_slot}`)
    }

    if (!order.delivery_date) out.push('в угоді не заповнена дата доставки')
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
    looked: 0, numbered: 0, linked: 0, moved: 0, waiting: 0, unmatched: [], problems: [],
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


    /*
     * Маркетплейсні замовлення теж потрапляють у цей список.
     *
     * У них немає ні дня доставки, ні періоду, ні номера ящика — їх везе
     * пошта, а не наш кур'єр. Тому й шукаємо їх за датою замовлення, а не
     * за датою доставки, якої в них просто немає.
     */
    const [{ data: ours }, { data: undated }, { data: markets }] = await Promise.all([
      service.from('orders').select(COLUMNS)
        .in('platform', ['site', 'manual'])
        .gte('delivery_date', day(-10)).lte('delivery_date', day(4)),
      /*
       * Порожня дата — теж дата, якої шукають.
       *
       * Умова на проміжок дат відкидає NULL мовчки, і замовлення без дня
       * не потрапляло в розгляд зовсім: картка на дошці є, замовлення в
       * базі є, а зчепити їх нема чим. Беремо їх за днем створення.
       */
      service.from('orders').select(COLUMNS)
        .in('platform', ['site', 'manual'])
        .is('delivery_date', null)
        .gte('order_date', day(-10)),
      service.from('orders').select(COLUMNS)
        .in('platform', ['maudau', 'rozetka'])
        .gte('order_date', day(-14)).lte('order_date', day(1)),
    ])

    const all = [
      ...(ours ?? []), ...(undated ?? []), ...(markets ?? []),
    ] as unknown as OrderRow[]

    /*
     * Коли нас покликали через конкретні замовлення, рештою не займаємось.
     *
     * Так виклик після огляду коштує один запит до Trello замість сорока,
     * і картка переїжджає за секунди, а не за три хвилини до наступного
     * проходу.
     */
    const orders = orderIds?.length ? all.filter(o => orderIds.includes(o.id)) : all

    /*
     * Ключ — телефон і день.
     *
     * Одна людина за тиждень замовляє двічі, і без дня картка
     * причепилась би до чужої доставки. А коли на той самий день і той
     * самий телефон замовлень два — ключ мовчки лишав останнє, і обидві
     * картки діставали один номер: на складі два ящики під одним
     * числом, а третього ящика немає зовсім.
     *
     * Такий день не вгадуємо. Картка лишається без номера, а про саму
     * двозначність сказано вголос — її розводить людина.
     */
    const phoneDay = new Map<string, OrderRow[]>()
    for (const o of orders) {
      /*
       * Скасоване за картку не змагається.
       *
       * Після об'єднання в того самого покупця на той самий день
       * лишається одне живе замовлення, а поруч — два закритих. Поки
       * вони рахувались нарівні, день виглядав двозначним, і картка
       * живого замовлення лишалась без номера й без бланка.
       */
      if (o.status === 'Скасовано') continue
      const key = phoneKey(o.customer_phone)
      if (key && o.delivery_date) {
        const k = `${key}|${o.delivery_date}`
        phoneDay.set(k, [...(phoneDay.get(k) ?? []), o])
      }
    }
    const byPhoneDay = new Map<string, OrderRow | 'ambiguous'>(
      [...phoneDay].map(([k, found]) => [k, found.length === 1 ? found[0] : 'ambiguous']),
    )

    /*
     * Замовлення, якому ще не поставили день.
     *
     * Картка на дошці вже є — інтеграція створила її одразу, і день у її
     * описі стоїть. А в угоді поле дати порожнє, тож за «телефон + день»
     * замовлення не знайти, і картка висить нічия. Тоді шукаємо за самим
     * телефоном — але тільки якщо таке замовлення в нього одне.
     *
     * Номера воно все одно не дістане: номер належить дню, а дня немає.
     * Зате в картці зявиться бланк і рядок про те, чого бракує, — і
     * порожня дата стане видимою там, де з нею працюють.
     */
    const undatedByPhone = new Map<string, OrderRow[]>()
    for (const o of orders) {
      // Скасоване за картку не змагається: воно вже нікуди не їде, а
      // через нього картка живого замовлення лишалась без зчеплення
      if (o.delivery_date || o.status === 'Скасовано') continue
      const key = phoneKey(o.customer_phone)
      if (key) undatedByPhone.set(key, [...(undatedByPhone.get(key) ?? []), o])
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
      if (o.status === 'Скасовано') continue
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

      const hit = date
        ? phones.map(p => byPhoneDay.get(`${p}|${date}`)).find(Boolean)
        : undefined

      if (hit === 'ambiguous') {
        result.unmatched.push({
          card: card.name.slice(0, 60),
          why: 'на цей день за цим телефоном два замовлення — номер не вгадуємо',
        })
        continue
      }

      const undated = phones
        .map(p => undatedByPhone.get(p))
        .find(found => found?.length === 1)?.[0]

      const order = hit
        ?? undated
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

      /*
       * Дві картки на одне замовлення.
       *
       * Чинна інтеграція зрідка створює картку двічі, і тоді склад
       * збирає один ящик, а бачить два завдання. Лишаємо ту, яку вже
       * знаємо, другу ховаємо в архів — не видаляємо: якщо це все-таки
       * різні замовлення, картку можна дістати назад.
       */
      if (order.trello_card_id && order.trello_card_id !== card.id) {
        /*
         * З двох карток лишаємо ту, що описує це замовлення.
         *
         * Перша-ліпша тут не годиться: після об'єднання на дошці висять
         * картки всіх трьох періодів, і картка з «11:00-14:00» поверх
         * замовлення на 17:00-20:00 відправляє кур'єра не в ту годину.
         * Порівнюємо період у картці з періодом замовлення.
         */
        const kept = cards.find(c => c.id === order.trello_card_id)
        const fits = (c: TrelloCard | undefined) =>
          !!order.delivery_slot && !!c && slotKey(slotInDesc(c.desc) ?? '') === slotKey(order.delivery_slot)

        const replace = fits(card) && !fits(kept)
        const drop = replace ? kept : card

        if (drop) await updateCard(drop.id, { closed: true })
        if (replace) {
          await service.from('orders')
            .update({ trello_card_id: card.id }).eq('id', order.id)
          order.trello_card_id = card.id
        }

        result.problems.push({
          card: (drop ?? card).name.slice(0, 60),
          number: order.manual_number,
          issues: ['друга картка на те саме замовлення — заархівовано'],
        })

        if (!replace) continue
      }

      if (!order.trello_card_id) {
        await service.from('orders')
          .update({ trello_card_id: card.id }).eq('id', order.id)
        order.trello_card_id = card.id
      }

      const issues = issuesOf(card, order)

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

      /*
       * Номер ящика попереду назви — склад шукає картку саме за ним.
       *
       * Номер у назві може бути й чужим: картку колись зчепили не з тим
       * замовленням, або замовлення перенесли й воно дістало інше число.
       * Тоді стара поведінка — «номер уже є, не чіпаємо» — лишала на
       * дошці завідомо хибне число. Тож звіряємо: не той — переписуємо.
       */
      if (order.manual_number != null) {
        const want = `№${order.manual_number}`
        const has = card.name.match(NUMBER_AT_START)?.[0]?.replace(/\s+/g, '')

        if (!has) {
          fields.name = `${want} ${card.name}`.slice(0, 16_384)
        } else if (has !== want) {
          fields.name = card.name.replace(NUMBER_AT_START, want).slice(0, 16_384)
          issues.push(`у назві стояв ${has}, виправлено на ${want}`)
        }
      }

      // Перелік хиб складено — тепер він і в картці, і в підсумку проходу
      if (issues.length) {
        result.problems.push({ card: card.name.slice(0, 60), number: order.manual_number, issues })
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
    result.waiting = spread.waiting
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

/** «11-14» → 11 година: початок вікна, яке тримає цей роздільник */
const separatorStart = (name: string) => {
  const m = name.trim().match(/^(\d{2})-(\d{2})$/)
  return m ? Number(m[1]) : null
}

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

/**
 * Роздільник для періоду, навіть коли період нестандартний.
 *
 * На дошці три вікна — 11-14, 14-17, 17-20, — а в угоді період може
 * стояти будь-який: «16:00-19:30» домовили з клієнтом окремо. Такій
 * картці місце не під власною годиною, якої на дошці немає, а в тому
 * вікні, у яке вона потрапляє початком: о 16:00 збирають разом із
 * чотирнадцятою. Інакше картка зависає в «Нових замовленнях», і ящик
 * просто не збере ніхто.
 */
function separatorFor(
  dest: Destination,
  slot: string,
): { id: string; pos: number } | undefined {
  const exact = dest.separators.get(slotKey(slot))
  if (exact) return exact

  const start = slotStartMinutes(slot)
  if (start == null) return undefined

  const hour = start / 60
  const windows = [...dest.separators.entries()]
    .map(([key, sep]) => ({ sep, from: separatorStart(`${key.slice(0, 2)}-${key.slice(2)}`) }))
    .filter((w): w is { sep: { id: string; pos: number }; from: number } => w.from != null)
    .sort((a, b) => a.from - b.from)

  if (!windows.length) return undefined

  // Останнє вікно, що починається не пізніше за наш період; якщо період
  // ранішій за всі — найперше
  const fit = [...windows].reverse().find(w => w.from <= hour)
  return (fit ?? windows[0]).sep
}

/**
 * Коли замовлення можна розкладати по складах.
 *
 * Склад збирає увечері напередодні, і до того часу картка має лежати в
 * «Нових замовленнях»: розкладене зарання змішується з тим, що везуть
 * сьогодні, і комірник бачить у своїй колонці ящики на два різні дні.
 *
 * Межа — 17:30 напередодні дати доставки. Замовлення на завтра чекає до
 * сьогоднішнього вечора; замовлення на понеділок, зроблене в середу,
 * чекає до недільного. Замовлення на сьогодні відкрите завжди: його
 * вечір був учора.
 */
const SPREAD_FROM_MINUTES = 17 * 60 + 30

export function spreadOpen(
  deliveryDate: string | null,
  now = new Date(),
): { open: boolean; from: string } {
  if (!deliveryDate) return { open: false, from: '—' }

  const eve = new Date(`${deliveryDate}T12:00:00`)
  eve.setDate(eve.getDate() - 1)
  const from = eve.toLocaleDateString('en-CA')

  const today = kyivToday(now)
  if (today > from) return { open: true, from }
  if (today < from) return { open: false, from }

  return { open: kyivMinutesNow(now) >= SPREAD_FROM_MINUTES, from }
}

export interface SpreadResult {
  moved: number
  /** Картки, яким ще рано: день доставки не настав */
  waiting: number
  problems: { card: string; why: string }[]
}

export async function spreadToPicking(
  service: Service,
  cards: { card: TrelloCard; order: OrderRow }[],
  boardId: string,
): Promise<SpreadResult> {
  const result: SpreadResult = { moved: 0, waiting: 0, problems: [] }
  const fit = cards.filter(({ order }) =>
    order.warehouse && order.delivery_slot && !isMarketplace(order)
    && order.status !== 'Скасовано')

  /*
   * Рано — значить рано.
   *
   * Картку на післязавтра лишаємо в «Нових замовленнях»: вона поїде на
   * склад свого вечора. Це не хиба й не привід щось правити, тож і в
   * перелік зауважень не йде — просто рахуємо, скільки чекає.
   */
  const ready = fit.filter(({ order }) => {
    const when = spreadOpen(order.delivery_date)
    if (!when.open) result.waiting++
    return when.open
  })

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

    const separator = separatorFor(dest, order.delivery_slot as string)
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
 * Номер на картці, яка вже поїхала на склад.
 *
 * Дописування працює зі списком «Нові замовлення», і цього досить,
 * поки номер з'являється раніше за переїзд. Але буває навпаки: картку
 * розклали по складах, а номер замовлення отримало за хвилину по тому —
 * і комірник дивиться на картку без числа, якого на ящику не бракує.
 *
 * Тому раз на прохід перечитуємо списки комплектації й дописуємо те,
 * чого там бракує. Зіставляємо за збереженою карткою, а якщо її немає —
 * за телефоном і днем, як і всюди.
 */
export async function numberInPicking(
  service: Service,
  { limit = 40 }: { limit?: number } = {},
): Promise<{ numbered: number; relisted: number; problems: string[] }> {
  const result = { numbered: 0, relisted: 0, problems: [] as string[] }
  if (!trelloConfigured()) return result

  const day = (shift: number) =>
    new Date(Date.now() + shift * 86_400_000).toISOString().slice(0, 10)

  const { data } = await service
    .from('orders')
    .select(COLUMNS)
    .in('platform', ['site', 'manual'])
    .not('manual_number', 'is', null)
    .gte('delivery_date', day(-3)).lte('delivery_date', day(4))

  const orders = (data ?? []) as unknown as OrderRow[]
  if (!orders.length) return result

  const byCard = new Map(
    orders.filter(o => o.trello_card_id).map(o => [o.trello_card_id as string, o]),
  )
  // Той самий захист, що й у дописуванні: двох замовлень одного клієнта
  // за один день картка не розрізнить, і вгадувати тут нічого
  const phoneDay = new Map<string, typeof orders>()
  for (const o of orders) {
    const key = phoneKey(o.customer_phone)
    if (key && o.delivery_date) {
      const k = `${key}|${o.delivery_date}`
      phoneDay.set(k, [...(phoneDay.get(k) ?? []), o])
    }
  }
  const byPhoneDay = new Map<string, typeof orders[number]>(
    [...phoneDay].filter(([, f]) => f.length === 1).map(([k, f]) => [k, f[0]]),
  )

  const board = await getSetting(service, 'trello_board')
  const lists = await boardLists(board)

  /*
   * Куди кожне замовлення належить зараз.
   *
   * Склад у замовленні міняється й після того, як картка поїхала: адресу
   * виправили, геокодер нарешті впізнав вулицю, оператор обрав склад
   * руками. Картка при цьому лишалась у старій колонці — і ящик збирали
   * там, звідки його вже не везуть.
   */
  const destinations = await pickingLists(board)
  const listName = new Map(lists.map(l => [l.id, l.name]))
  /*
   * Дивимось не лише в списки комплектації.
   *
   * Картку з комплектації забирає кур'єр — і вона переїжджає в список з
   * його іменем. Поки ми заглядали тільки в «…комплектується», картка з
   * хибним числом лишалась у кур'єра до кінця дня, і саме там воно
   * коштує найдорожче: за цим числом шукають ящик у машині.
   *
   * Обминаємо лише те, де числу вже байдуже: нові замовлення (їх веде
   * дописування), маркетплейс, доставлене й недоставлене.
   */
  const SKIP = /нові замовлення|маркетплейс|не\s*достав|доставлен|архів/i

  for (const list of lists) {
    if (SKIP.test(list.name)) continue

    for (const card of await listCards(list.id)) {
      if (result.numbered + result.relisted >= limit) return result

      const text = `${card.name}
${card.desc}`
      const date = dateFromDesc(card.desc)
      const order = byCard.get(card.id)
        ?? (date
          ? phonesIn(text).map(p => byPhoneDay.get(`${p}|${date}`)).find(Boolean)
          : undefined)

      if (!order) continue

      /*
       * Не лише дописуємо — виправляємо.
       *
       * Число в назві буває чуже: замовлення перенесли, об'єднали або
       * номер розійшовся з журналом. Поки діяло правило «номер уже є, не
       * чіпаємо», така картка лишалась із хибним числом до кінця дня, і
       * комірник шукав ящик, якого немає.
       */
      if (!order.trello_card_id) {
        await service.from('orders')
          .update({ trello_card_id: card.id }).eq('id', order.id)
      }

      const want = `№${order.manual_number}`
      const has = card.name.match(NUMBER_AT_START)?.[0]?.replace(/\s+/g, '')

      const fields: { name?: string; desc?: string } = {}

      if (has !== want) {
        fields.name = (has
          ? card.name.replace(NUMBER_AT_START, want)
          : `${want} ${card.name}`).slice(0, 16_384)
      }

      /*
       * Наш блок в описі теж має казати правду.
       *
       * Там стоїть склад — і коли він змінився, картка переїжджає в іншу
       * колонку, а в описі лишається стара назва. Комірник читає опис,
       * а не те, у якій колонці картка лежить.
       */
      const desc = `${stripOurs(card.desc)}\n\n${ourBlock(order, issuesOf(card, order))}`
      if (desc.trim() !== card.desc.trim()) fields.desc = desc

      if (Object.keys(fields).length) {
        await updateCard(card.id, fields)
        if (fields.name) result.numbered++
      }

      /*
       * Склад у картці має бути той, що в замовленні.
       *
       * Поки картка стоїть у комплектації, її ніхто більше не чіпає — а
       * склад тим часом змінюється: виправили адресу, геокодер упізнав
       * вулицю, оператор обрав інший руками. Ящик тоді збирають там,
       * звідки його вже не везуть, і дізнаються про це ввечері.
       */
      const moved = await relist(service, card, order, destinations, listName)
      if (moved === 'moved') result.relisted++
      else if (moved) result.problems.push(`${want}: ${moved}`)
    }
  }

  return result
}

/**
 * Переставляє картку в колонку свого складу й під свій період.
 *
 * Повертає «moved», якщо переставили; текст — якщо не змогли; null, якщо
 * вона й так стоїть правильно.
 */
async function relist(
  service: Service,
  card: TrelloCard,
  order: {
    id: string; warehouse: string | null; delivery_slot: string | null
    status: string | null
  },
  destinations: Map<string, Destination>,
  listName: Map<string, string>,
): Promise<'moved' | string | null> {
  if (!order.warehouse || !order.delivery_slot) return null

  // Скасоване веде інший шлях — у «Не доставлено», і не звідси
  if (order.status === 'Скасовано') return null

  const key = stripNoise(order.warehouse)
  const dest = destinations.get(ALIAS[key] ?? key)
  if (!dest) return `на дошці немає списку для складу «${order.warehouse}»`

  const separator = separatorFor(dest, order.delivery_slot)
  if (!separator) return `у списку «${order.warehouse}» немає періоду ${order.delivery_slot}`

  /*
   * Картку, яку вже забрав кур'єр, назад не тягнемо.
   *
   * Його список — не склад, і переставити звідти означає забрати в нього
   * з рук те, що він щойно взяв. Склад у замовленні при цьому поправили
   * не дарма, тож кажемо про розбіжність уголос.
   */
  const where = listName.get(card.idList) ?? ''
  const inPicking = /комплект/i.test(where)
  if (!inPicking) {
    return card.idList === dest.listId
      ? null
      : `картка вже в «${where}», а склад замовлення — «${order.warehouse}»`
  }

  if (card.idList === dest.listId) return null

  const pos = positionUnder(dest, separator)
  await updateCard(card.id, { idList: dest.listId, pos })
  dest.cards.push({ ...card, idList: dest.listId, pos })

  return 'moved'
}

/**
 * Прибирання в «Не доставлено».
 *
 * Туди кладуть картки скасованих замовлень, і ніхто їх звідти не
 * забирає: за місяць список виріс до сотень карток, і розібрати в ньому
 * вчорашнє вже неможливо. Лишаємо свіже — те, у чому ще можуть
 * розбиратись, — а старше ховаємо в архів. Архів у Trello не видаляє:
 * картку завжди можна дістати назад.
 */
export async function tidyFailed(
  service: Service,
  { days = 14, limit = 120 }: { days?: number; limit?: number } = {},
): Promise<{ archived: number; left: number }> {
  if (!trelloConfigured()) return { archived: 0, left: 0 }

  const board = await getSetting(service, 'trello_board')
  const lists = await boardLists(board)
  const failed = lists.find(l => /не\s*достав/i.test(l.name))
  if (!failed) return { archived: 0, left: 0 }

  const cards = await listCards(failed.id)
  const edge = Date.now() - days * 86_400_000

  let archived = 0
  for (const card of cards) {
    if (archived >= limit) break
    const touched = Date.parse(card.dateLastActivity ?? '')
    if (!Number.isFinite(touched) || touched >= edge) continue

    await updateCard(card.id, { closed: true })
    archived++
  }

  return { archived, left: cards.length - archived }
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

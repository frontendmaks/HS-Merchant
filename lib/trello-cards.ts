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
import { listCards, updateCard, trelloConfigured, type TrelloCard } from '@/lib/trello'
import { getSetting } from '@/lib/settings'
import { phoneKey } from '@/lib/phone'

type Service = ReturnType<typeof createServiceClient>

const MARK = '— — — Мерчант — — —'

export interface CardResult {
  looked: number
  numbered: number
  linked: number
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

const NUMBER_AT_START = /^\s*№\s*\d+/u

/** Те, що ми дописали минулого разу, прибираємо — блок перепишеться начисто */
const stripOurs = (desc: string) => desc.split(MARK)[0].trimEnd()

interface OrderRow {
  id: string
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
function issuesOf(card: TrelloCard, order: OrderRow): string[] {
  const out: string[] = []
  const text = `${card.name}\n${card.desc}`

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
  if (!order.address?.trim()) out.push('у замовленні немає адреси')

  if (/Клієнт:?\s*\*{0,2}Не вказано/iu.test(text)) out.push('у картці не вказано клієнта')

  const phones = phonesIn(text)
  if (!phones.length) out.push('у картці немає телефону')
  else if (order.customer_phone && !phones.includes(phoneKey(order.customer_phone))) {
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
  if (issues.length) lines.push('', '⚠️ Перевірити:', ...issues.map(i => `• ${i}`))
  return lines.join('\n')
}

export async function enrichNewCards(
  service: Service,
  { limit = 40 }: { limit?: number } = {},
): Promise<CardResult> {
  const result: CardResult = { looked: 0, numbered: 0, linked: 0, unmatched: [], problems: [] }

  if (!trelloConfigured()) return { ...result, error: 'TRELLO_KEY/TRELLO_TOKEN не налаштовано' }
  if (!await getSetting(service, 'trello_enrich')) return { ...result, error: 'Вимкнено' }

  try {
    const listId = await getSetting(service, 'trello_new_list')
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

    const { data } = await service
      .from('orders')
      .select('id, manual_number, delivery_date, delivery_slot, address, customer_name, customer_phone, warehouse, share_token, status')
      .in('platform', ['site', 'manual'])
      .gte('delivery_date', day(-10))
      .lte('delivery_date', day(4))

    const orders = (data ?? []) as unknown as OrderRow[]

    // Ключ — телефон і день: одна людина за тиждень замовляє двічі, і без
    // дня картка причепилась би до чужої доставки
    const byPhoneDay = new Map<string, OrderRow>()
    for (const o of orders) {
      const key = phoneKey(o.customer_phone)
      if (key && o.delivery_date) byPhoneDay.set(`${key}|${o.delivery_date}`, o)
    }

    for (const card of cards) {
      const text = `${card.name}\n${card.desc}`
      const date = dateFromDesc(card.desc)
      const phones = phonesIn(text)

      if (!phones.length) {
        result.unmatched.push({ card: card.name.slice(0, 60), why: 'у картці немає телефону' })
        continue
      }
      if (!date) {
        result.unmatched.push({ card: card.name.slice(0, 60), why: 'у картці немає дати доставки' })
        continue
      }

      const order = phones.map(p => byPhoneDay.get(`${p}|${date}`)).find(Boolean)
      if (!order) {
        result.unmatched.push({
          card: card.name.slice(0, 60),
          why: `замовлення на ${date} за цим телефоном не знайдено`,
        })
        continue
      }

      const issues = issuesOf(card, order)
      if (issues.length) {
        result.problems.push({ card: card.name.slice(0, 60), number: order.manual_number, issues })
      }

      const fields: { name?: string; desc?: string } = {}

      // Номер ящика попереду назви — склад шукає картку саме за ним
      if (order.manual_number != null && !NUMBER_AT_START.test(card.name)) {
        fields.name = `№${order.manual_number} ${card.name}`.slice(0, 16_384)
      }

      const desc = `${stripOurs(card.desc)}\n\n${ourBlock(order, issues)}`
      if (desc.trim() !== card.desc.trim()) fields.desc = desc

      if (!Object.keys(fields).length) continue

      await updateCard(card.id, fields)
      if (fields.name) result.numbered++
      if (fields.desc) result.linked++
    }

    return result
  } catch (e) {
    return { ...result, error: e instanceof Error ? e.message : 'помилка Trello' }
  }
}

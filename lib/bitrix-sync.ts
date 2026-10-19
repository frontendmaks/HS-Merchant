/**
 * Замовлення з сайту — з Бітрікса в Мерчант.
 *
 * Сайт складає замовлення в CRM, і для Мерчанта вона першоджерело: ми не
 * вигадуємо їх наново, а забираємо. Забираємо лише те, що змінилось — у
 * воронці сто двадцять тисяч угод, і повне вичитування не має сенсу ні разу
 * на п'ять хвилин, ні взагалі.
 */
import { bitrix } from '@/lib/bitrix'
import { createServiceClient } from '@/lib/supabase/service'
import { stageName, CLOSED_STAGES } from '@/lib/bitrix-stages'
import { WAREHOUSE_ID, SLOT_ID, CATEGORY_ID } from '@/lib/bitrix-deal'

type Service = ReturnType<typeof createServiceClient>

const WAREHOUSE_BY_ID = new Map(
  Object.entries(WAREHOUSE_ID).map(([name, id]) => [String(id), name]),
)
const SLOT_BY_ID = new Map(
  Object.entries(SLOT_ID).map(([label, id]) => [String(id), label]),
)

interface Deal {
  ID: string
  TITLE: string
  STAGE_ID: string
  CONTACT_ID: string | null
  OPPORTUNITY: string
  DATE_CREATE: string
  DATE_MODIFY: string
  COMMENTS: string | null
  UF_CRM_1607510002583: string | null   // номер ящика
  UF_BILL_ADRESS_LIST: string | null    // склад
  UF_CRM_1606047095: string | null      // дата доставки
  UF_CRM_1606047143435: string | null   // період
  UF_CRM_1606294264905: string | null   // адреса
  UF_DEST_PERSONA: string | null
  UF_ORDER_KEY: string | null
}

const DEAL_FIELDS = [
  'ID', 'TITLE', 'STAGE_ID', 'CONTACT_ID', 'OPPORTUNITY', 'DATE_CREATE', 'DATE_MODIFY',
  'COMMENTS', 'UF_CRM_1607510002583', 'UF_BILL_ADRESS_LIST', 'UF_CRM_1606047095',
  'UF_CRM_1606047143435', 'UF_CRM_1606294264905', 'UF_DEST_PERSONA', 'UF_ORDER_KEY',
]

/** Телефони й імена контактів — одним запитом на всю сторінку угод. */
async function contacts(ids: string[]) {
  const map = new Map<string, { name: string; phone: string | null }>()
  if (!ids.length) return map

  const rows = await bitrix<{
    ID: string; NAME: string | null; LAST_NAME: string | null
    PHONE?: { VALUE: string }[]
  }[]>('crm.contact.list', {
    filter: { ID: ids },
    select: ['ID', 'NAME', 'LAST_NAME', 'PHONE'],
  })

  for (const c of rows ?? []) {
    map.set(c.ID, {
      name: [c.LAST_NAME, c.NAME].filter(Boolean).join(' ').trim(),
      phone: c.PHONE?.[0]?.VALUE ?? null,
    })
  }
  return map
}

interface Row {
  PRODUCT_ID: string; PRODUCT_NAME: string; PRICE: string; QUANTITY: string
  MEASURE_NAME?: string | null
}

/**
 * Одиниця позиції.
 *
 * Бітрікс присилає свою міру — «кг», «шт», «Пачка». Писати всюди «шт»
 * означало б показати «0.6 шт філе» там, де насправді 600 грамів: комірник
 * збере не те, а оператор не помітить.
 */
function unitOf(row: Row): string {
  const m = (row.MEASURE_NAME ?? '').trim().toLowerCase()
  if (m.startsWith('кг')) return 'кг'
  if (m) return 'шт'
  // Міри немає — дробова кількість сама себе видає: штуками так не беруть
  return Number(row.QUANTITY) % 1 === 0 ? 'шт' : 'кг'
}

/**
 * Позиції одразу для багатьох угод.
 *
 * Бітрікс уміє приймати пачку викликів одним запитом — п'ятдесят за раз.
 * Поодинці це був би запит на кожну угоду, тобто сотня запитів на одну
 * синхронізацію.
 */
async function productRows(dealIds: string[]) {
  const out = new Map<string, Row[]>()

  for (let i = 0; i < dealIds.length; i += 50) {
    const chunk = dealIds.slice(i, i + 50)
    const cmd: Record<string, string> = {}
    for (const id of chunk) cmd[`d${id}`] = `crm.deal.productrows.get?id=${id}`

    const res = await bitrix<{ result: Record<string, Row[]> }>('batch', { halt: 0, cmd })
    for (const id of chunk) out.set(id, res?.result?.[`d${id}`] ?? [])
  }
  return out
}

export interface SyncResult {
  seen: number
  created: number
  updated: number
  error?: string
}

/**
 * Забирає з Бітрікса угоди, змінені від `since`.
 *
 * Угоди, створені з наших же ручних замовлень, теж сюди потрапляють — і це
 * правильно: якщо оператор пересунув таке замовлення в CRM, Мерчант має
 * показувати те саме.
 */
export async function syncSiteOrders(
  service: Service,
  { since, maxPages = 10 }: { since: string; maxPages?: number },
): Promise<SyncResult> {
  const result: SyncResult = { seen: 0, created: 0, updated: 0 }

  try {
    for (let page = 0; page < maxPages; page++) {
      const deals = await bitrix<Deal[]>('crm.deal.list', {
        filter: { CATEGORY_ID, '>=DATE_MODIFY': since },
        select: DEAL_FIELDS,
        order: { DATE_MODIFY: 'ASC' },
        start: page * 50,
      })

      if (!deals?.length) break
      result.seen += deals.length

      const people = await contacts(
        [...new Set(deals.map(d => d.CONTACT_ID).filter(Boolean) as string[])],
      )
      const rowsByDeal = await productRows(deals.map(d => d.ID))

      for (const deal of deals) {
        const person = deal.CONTACT_ID ? people.get(deal.CONTACT_ID) : undefined
        const status = stageName(deal.STAGE_ID) ?? deal.STAGE_ID
        const rows = rowsByDeal.get(deal.ID) ?? []

        const fields = {
          external_id: `BX-${deal.ID}`,
          platform: 'site',
          bitrix_deal_id: Number(deal.ID),
          order_date: deal.DATE_CREATE.slice(0, 10),
          delivery_date: deal.UF_CRM_1606047095?.slice(0, 10) ?? null,
          delivery_slot: SLOT_BY_ID.get(deal.UF_CRM_1606047143435 ?? '') ?? null,
          warehouse: WAREHOUSE_BY_ID.get(deal.UF_BILL_ADRESS_LIST ?? '') ?? null,
          customer_name: person?.name || deal.UF_DEST_PERSONA || deal.TITLE,
          customer_phone: person?.phone ?? null,
          address: deal.UF_CRM_1606294264905 ?? null,
          status,
          total: Number(deal.OPPORTUNITY ?? 0),
          commission: 0,
          manual_number: deal.UF_CRM_1607510002583
            ? Number(deal.UF_CRM_1607510002583) || null
            : null,
          customer_comment: deal.COMMENTS?.trim() || null,
          items: rows.map(r =>
            `${r.PRODUCT_NAME}, ${Number(r.QUANTITY)} ${unitOf(r)} x ${Number(r.PRICE)} грн`)
            .join('\n'),
          updated_at: new Date().toISOString(),
        }

        const { data: existing } = await service
          .from('orders').select('id, platform')
          .eq('bitrix_deal_id', Number(deal.ID)).maybeSingle()

        if (existing) {
          /**
           * Ручне замовлення ми ведемо самі.
           *
           * Воно народилось у Мерчанті: склад, період, адреса й позиції тут
           * точніші, ніж те, що з них вийшло в угоді. З Бітрікса беремо лише
           * статус — його там і міняють.
           */
          const ours = existing.platform === 'manual'

          await service.from('orders')
            .update(ours ? { status, updated_at: fields.updated_at } : fields)
            .eq('id', existing.id)

          if (!ours) await saveRows(service, existing.id as string, rows)
          result.updated++
        } else {
          const { data: created } = await service
            .from('orders').insert(fields).select('id').single()
          if (created) {
            await saveRows(service, created.id as string, rows)
            result.created++
          }
        }
      }

      if (deals.length < 50) break
    }
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e)
  }

  return result
}

/**
 * Позиції замовлення переписуються цілком.
 *
 * Зіставляти рядок із рядком нема за чим: у Бітріксі в позиції немає свого
 * сталого номера, тільки порядок. Зате склад замовлення там — остання правда,
 * тож просто беремо його таким, як є.
 */
async function saveRows(service: Service, orderId: string, rows: Row[]) {
  await service.from('order_items').delete().eq('order_id', orderId).eq('source', 'site')

  if (!rows.length) return

  await service.from('order_items').insert(rows.map((r, i) => ({
    order_id: orderId,
    position: i,
    source: 'site',
    title: r.PRODUCT_NAME,
    bitrix_product_id: Number(r.PRODUCT_ID) || null,
    unit: unitOf(r),
    unit_weight: 0,
    price_per_unit: Number(r.PRICE),
    ordered_qty: Number(r.QUANTITY),
    ordered_total: Math.round(Number(r.PRICE) * Number(r.QUANTITY) * 100) / 100,
    removed: false,
  })))
}

/** Замовлення, які ще в роботі — їх варто перепитувати навіть без змін. */
export const isOpenOrder = (status: string | null) =>
  !!status && !CLOSED_STAGES.includes(status)

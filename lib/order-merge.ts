/**
 * Об'єднання передзамовлень в одне.
 *
 * Сайт дозволяє покупцеві взяти лише одну позицію за раз, тож людина, яка
 * хоче чотири товари, лишає чотири замовлення. Для складу це чотири ящики
 * на одну адресу, чотири бланки й чотири поїздки в одне місце.
 *
 * Тому об'єднуємо: народжується одне замовлення з усіма позиціями, своїм
 * номером і своєю угодою, а вихідні закриваються — так само, як при
 * перенесенні на інший день. Аналітика їх не рахує, інакше той самий
 * покупець і ті самі гроші потрапили б у підсумок двічі.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { randomBytes } from 'node:crypto'
import { bitrix } from '@/lib/bitrix'
import {
  FIELD, WAREHOUSE_ID, SLOT_ID, CATEGORY_ID, NEW_STAGE, ASSIGNED_BY, contactFor,
} from '@/lib/bitrix-deal'
import { stageId, stageName } from '@/lib/bitrix-stages'
import { phoneKey } from '@/lib/phone'

type Service = ReturnType<typeof createServiceClient>

export const MERGED_REASON = 'об’єднано в одне замовлення'

export interface MergeResult {
  orderId: string
  dealId: number
  merged: number
  lines: number
}

interface Row {
  id: string
  bitrix_deal_id: number | null
  customer_name: string | null
  customer_phone: string | null
  address: string | null
  warehouse: string | null
  warehouse_pinned: boolean | null
  delivery_zone: string | null
  area: string | null
  customer_comment: string | null
  delivery_date: string | null
  status: string | null
  moved_to_order_id: string | null
  total: number | null
}

export async function mergeOrders(
  service: Service,
  { orderIds, deliveryDate, deliverySlot }: {
    orderIds: string[]
    deliveryDate: string
    deliverySlot: string
  },
): Promise<MergeResult | { error: string }> {
  if (orderIds.length < 2) return { error: 'Оберіть принаймні два замовлення' }

  const { data } = await service
    .from('orders')
    .select('id, bitrix_deal_id, customer_name, customer_phone, address, warehouse, warehouse_pinned, delivery_zone, area, customer_comment, delivery_date, status, moved_to_order_id, total')
    .in('id', orderIds)

  const rows = (data ?? []) as unknown as Row[]
  if (rows.length !== orderIds.length) return { error: 'Якісь із замовлень не знайдено' }
  if (rows.some(r => r.moved_to_order_id)) {
    return { error: 'Якесь із замовлень уже об’єднане або перенесене' }
  }

  /*
   * Один покупець — одне замовлення.
   *
   * Звіряємось за телефоном, а не за іменем: у цих замовленнях ім'я
   * буває різне («Дмитро» і «Антоніна» з одного номера), бо на сайті
   * його вписують щоразу наново. Телефон же той самий, і саме він
   * визначає, кому везти.
   */
  const phones = new Set(rows.map(r => phoneKey(r.customer_phone)).filter(Boolean))
  if (phones.size !== 1) {
    return { error: 'Замовлення різних покупців об’єднувати не можна' }
  }

  // Беремо найперше за порядком — його адресу й склад оператор уже бачив
  const base = rows.find(r => r.id === orderIds[0]) ?? rows[0]

  const { data: items } = await service
    .from('order_items')
    .select('*')
    .in('order_id', orderIds)
    .eq('removed', false)
    .order('position')

  const lines = items ?? []
  if (!lines.length) return { error: 'У цих замовленнях немає позицій' }

  const contactId = base.customer_name && base.customer_phone
    ? await contactFor(base.customer_name, base.customer_phone)
    : null

  const total = Math.round(
    lines.reduce((s, l) => s + Number(l.ordered_total ?? 0), 0) * 100,
  ) / 100

  const fields: Record<string, unknown> = {
    TITLE: `Замовлення (об’єднано ${rows.length})`,
    CATEGORY_ID,
    STAGE_ID: NEW_STAGE,
    ASSIGNED_BY_ID: ASSIGNED_BY,
    CURRENCY_ID: 'UAH',
    OPENED: 'Y',
    COMMENTS: [
      base.customer_comment,
      `Об’єднано з ${rows.length} передзамовлень: `
        + rows.map(r => r.bitrix_deal_id ? `#${r.bitrix_deal_id}` : '—').join(', '),
    ].filter(Boolean).join('\n'),
    ...(contactId ? { CONTACT_ID: contactId } : {}),
    [FIELD.warehouse]: base.warehouse ? WAREHOUSE_ID[base.warehouse] ?? '' : '',
    [FIELD.deliveryDate]: `${deliveryDate}T03:00:00+03:00`,
    [FIELD.deliverySlot]: SLOT_ID[deliverySlot] ?? '',
    [FIELD.address]: base.address ?? '',
  }

  let dealId: number
  try {
    dealId = Number(await bitrix<number>('crm.deal.add', {
      fields, params: { REGISTER_SONET_EVENT: 'N' },
    }))
    if (!dealId) throw new Error('Бітрікс не повернув номер угоди')

    await bitrix('crm.deal.productrows.set', {
      id: dealId,
      rows: lines.map(l => ({
        ...(l.bitrix_product_id ? { PRODUCT_ID: l.bitrix_product_id } : {}),
        PRODUCT_NAME: l.title,
        PRICE: Number(l.price_per_unit ?? 0),
        QUANTITY: Number(l.ordered_qty ?? 1),
      })),
    })
  } catch (e) {
    return { error: `Угоду створити не вдалося: ${e instanceof Error ? e.message : e}` }
  }

  /*
   * Номер з журналу не беремо.
   *
   * Його видасть огляд — той самий, що й для звичайного замовлення. Так
   * об'єднане проходить рівно той шлях, що й решта, замість окремої
   * гілки, яка колись розійдеться з головною.
   */
  const { data: created, error } = await service.from('orders').insert({
    external_id: `BX-${dealId}`,
    platform: 'site',
    bitrix_deal_id: dealId,
    order_date: new Date().toISOString().slice(0, 10),
    delivery_date: deliveryDate,
    delivery_slot: deliverySlot,
    warehouse: base.warehouse,
    warehouse_pinned: base.warehouse_pinned,
    delivery_zone: base.delivery_zone,
    area: base.area,
    address: base.address,
    customer_name: base.customer_name,
    customer_phone: base.customer_phone,
    customer_comment: base.customer_comment,
    status: stageName(NEW_STAGE) ?? 'В обробці',
    total,
    commission: 0,
    items: lines
      .map(l => `${l.title}, ${Number(l.ordered_qty)} ${l.unit ?? 'шт'} x ${Number(l.price_per_unit)} грн`)
      .join('\n'),
    share_token: randomBytes(18).toString('base64url'),
  }).select('id').single()

  if (error || !created) {
    return { error: `Угоду створено (#${dealId}), але замовлення — ні: ${error?.message}` }
  }

  await service.from('order_items').insert(lines.map((l, i) => {
    const { id: _id, order_id: _order, created_at: _c, updated_at: _u, position: _p, ...rest } = l
    return { ...rest, order_id: created.id, position: i }
  }))

  /*
   * Вихідні закриваємо.
   *
   * Вони лишаються в системі — з ними пов'язана історія, — але більше
   * нікуди не їдуть, і 1С їх удруге не забере. В аналітиці не рахуються:
   * ті самі гроші вже лежать в об'єднаному.
   */
  const canceled = stageId('Скасовано')
  for (const row of rows) {
    if (row.bitrix_deal_id && canceled) {
      await bitrix('crm.deal.update', {
        id: row.bitrix_deal_id,
        fields: {
          STAGE_ID: canceled,
          [FIELD.boxNumber]: '',
          COMMENTS: `Об’єднано в угоду #${dealId}`,
        },
      }).catch(() => null)
    }
  }

  await service.from('orders').update({
    status: 'Скасовано',
    cancel_reason: MERGED_REASON,
    moved_to_order_id: created.id,
    manual_number: null,
    auto_done_at: new Date().toISOString(),
    auto_problem: null,
    updated_at: new Date().toISOString(),
  }).in('id', orderIds)

  return {
    orderId: created.id as string,
    dealId,
    merged: rows.length,
    lines: lines.length,
  }
}

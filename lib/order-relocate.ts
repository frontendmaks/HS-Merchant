/**
 * Перенесення замовлення на інший день.
 *
 * Раніше ми просто міняли дату в угоді. Для Мерчанта цього досить, а для
 * 1С — ні: вона забирає замовлення один раз, і змінена дата її вже не
 * стосується. Комплектувальники нового дня такого замовлення не бачили
 * зовсім.
 *
 * Тому перенесення — це не правка, а переїзд: на новий день народжується
 * окреме замовлення зі своїм номером і своєю угодою, а старе закривається.
 * Так його видно всім, хто дивиться на новий день, і 1С забирає його як
 * будь-яке інше.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { randomBytes } from 'node:crypto'
import { bitrix } from '@/lib/bitrix'
import {
  FIELD, WAREHOUSE_ID, CATEGORY_ID, NEW_STAGE, ASSIGNED_BY,
} from '@/lib/bitrix-deal'
import { slotId } from '@/lib/bitrix-slots'
import { stageId, stageName } from '@/lib/bitrix-stages'
import { reserveNumber, releaseNumber } from '@/lib/manual-register'

type Service = ReturnType<typeof createServiceClient>

/** Причина, за якою старе замовлення закривається. Не втрата клієнта. */
export const RELOCATED_REASON = 'перенесено на інший день'

export interface Relocation {
  orderId: string
  number: number | null
  dealId: number | null
  note: string | null
}

interface DealRow {
  PRODUCT_ID?: number
  PRODUCT_NAME: string
  PRICE: number
  QUANTITY: number
}

export async function relocateOrder(
  service: Service,
  { orderId, toDate }: { orderId: string; toDate: string },
): Promise<Relocation | { error: string }> {
  const { data: order } = await service
    .from('orders').select('*').eq('id', orderId).single()

  if (!order) return { error: 'Замовлення не знайдено' }
  if (order.moved_to_order_id) return { error: 'Це замовлення вже перенесено' }
  if (order.delivery_date === toDate) return { error: 'Це та сама дата' }

  const customer = (order.customer_name as string) || 'замовлення'

  /*
   * Номер беремо першим.
   *
   * Якщо номерів на новий день не лишилось, переносити нікуди: краще
   * відмовити одразу, ніж створити угоду, яку склад не знайде за номером.
   */
  const reserved = await reserveNumber(service, toDate, customer)
  if (reserved.source !== 'sheet') {
    return { error: reserved.note ?? 'Не вдалося взяти номер у журналі' }
  }

  // Позиції беремо з угоди, а не з наших рядків: саме їх бачить склад і
  // саме з ними працює 1С
  const rows = order.bitrix_deal_id
    ? (await bitrix<DealRow[]>('crm.deal.productrows.get', { id: order.bitrix_deal_id })) ?? []
    : []

  /*
   * Клієнт переїжджає разом із замовленням.
   *
   * Беремо контакт зі старої угоди, а не шукаємо наново: там він уже
   * правильний, і друге зіставлення за телефоном могло б завести дубль.
   */
  const previous = order.bitrix_deal_id
    ? await bitrix<{ CONTACT_ID?: string }>('crm.deal.get', { id: order.bitrix_deal_id })
    : null
  const contactId = Number(previous?.CONTACT_ID ?? 0) || null

  const fields: Record<string, unknown> = {
    TITLE: `Замовлення №${reserved.number} (перенесено з ${order.delivery_date})`,
    CATEGORY_ID,
    STAGE_ID: NEW_STAGE,
    ASSIGNED_BY_ID: ASSIGNED_BY,
    CURRENCY_ID: 'UAH',
    OPENED: 'Y',
    COMMENTS: [
      order.customer_comment, order.operator_comment,
      `Перенесено з ${order.delivery_date}, попередня угода #${order.bitrix_deal_id ?? '—'}`,
    ].filter(Boolean).join('\n'),
    ...(contactId ? { CONTACT_ID: contactId } : {}),
    [FIELD.boxNumber]: String(reserved.number),
    [FIELD.warehouse]: order.warehouse ? WAREHOUSE_ID[order.warehouse as string] ?? '' : '',
    [FIELD.deliveryDate]: `${toDate}T03:00:00+03:00`,
    [FIELD.deliverySlot]: await slotId(order.delivery_slot as string | null),
    [FIELD.address]: order.address ?? '',
  }

  /*
   * Якщо угода не створиться, номер треба повернути.
   *
   * Інакше в журналі лишиться зайнятий рядок із іменем, за яким немає
   * замовлення, — і наступне замовлення дістане номер на один більший,
   * ніж мало б, назавжди.
   */
  let dealId: number
  try {
    dealId = Number(await bitrix<number>('crm.deal.add', {
      fields, params: { REGISTER_SONET_EVENT: 'N' },
    }))
    if (!dealId) throw new Error('Бітрікс не повернув номер угоди')

    if (rows.length) {
      await bitrix('crm.deal.productrows.set', {
        id: dealId,
        rows: rows.map(r => ({
          ...(r.PRODUCT_ID ? { PRODUCT_ID: r.PRODUCT_ID } : {}),
          PRODUCT_NAME: r.PRODUCT_NAME,
          PRICE: r.PRICE,
          QUANTITY: r.QUANTITY,
        })),
      })
    }
  } catch (e) {
    await releaseNumber(service, { number: reserved.number, date: toDate })
    return { error: `Угоду створити не вдалося: ${e instanceof Error ? e.message : e}` }
  }

  /*
   * Нове замовлення в Мерчанті.
   *
   * Поля переносимо ті, що описують саме замовлення. Усе, що описує його
   * шлях — огляд, бланк, скасування, накладна — починається з чистого
   * аркуша: це новий день і нова робота.
   */
  const { data: created, error } = await service.from('orders').insert({
    external_id: `BX-${dealId}`,
    platform: order.platform,
    bitrix_deal_id: dealId,
    order_date: new Date().toISOString().slice(0, 10),
    delivery_date: toDate,
    delivery_slot: order.delivery_slot,
    warehouse: order.warehouse,
    warehouse_pinned: order.warehouse_pinned,
    delivery_zone: order.delivery_zone,
    area: order.area,
    address: order.address,
    customer_name: order.customer_name,
    customer_phone: order.customer_phone,
    customer_comment: order.customer_comment,
    operator_comment: order.operator_comment,
    items: order.items,
    total: order.total,
    commission: order.commission,
    weight: order.weight,
    status: stageName(NEW_STAGE) ?? 'В обробці',
    manual_number: reserved.number,
    number_source: 'sheet',
    share_token: randomBytes(18).toString('base64url'),
  }).select('id').single()

  if (error || !created) {
    // Угода вже є, тож номер лишається за нею — інакше склад шукав би
    // ящик, якого немає в журналі. Але людина має дізнатись про розрив
    return {
      error: `Угоду створено (#${dealId}) з номером ${reserved.number}, `
        + `але замовлення в Мерчанті — ні: ${error?.message}`,
    }
  }

  // Позиції — копією, щоб бланк нового дня не залежав від старого запису
  const { data: lines } = await service
    .from('order_items').select('*').eq('order_id', orderId).eq('removed', false)

  if (lines?.length) {
    await service.from('order_items').insert(lines.map(l => {
      const { id: _id, order_id: _order, created_at: _c, updated_at: _u, ...rest } = l
      return { ...rest, order_id: created.id }
    }))
  }

  /*
   * Старе закриваємо.
   *
   * Воно лишається в системі — з ним пов'язані дзвінки, коментарі й історія,
   * і стирати їх означало б утратити те, через що замовлення й переносили.
   * Але воно більше нікуди не їде, і 1С його вдруге не забере.
   */
  const canceled = stageId('Скасовано')
  if (order.bitrix_deal_id && canceled) {
    await bitrix('crm.deal.update', {
      id: order.bitrix_deal_id,
      fields: {
        STAGE_ID: canceled,
        [FIELD.boxNumber]: '',
        COMMENTS: `${order.customer_comment ?? ''}\nПеренесено на ${toDate}, нова угода #${dealId}`.trim(),
      },
    })
  }

  await service.from('orders').update({
    status: 'Скасовано',
    cancel_reason: RELOCATED_REASON,
    moved_to_order_id: created.id,
    manual_number: null,
    auto_done_at: new Date().toISOString(),
    auto_problem: null,
    updated_at: new Date().toISOString(),
  }).eq('id', orderId)

  // Старий рядок у журналі звільняємо — ящика з цим номером того дня не буде
  const freed = order.manual_number != null && order.delivery_date
    ? await releaseNumber(service, {
        number: Number(order.manual_number),
        date: order.delivery_date as string,
      })
    : true

  /*
   * Клієнт має почути це від нас.
   *
   * Він чекає сьогодні. Якщо не сказати, він чекатиме до вечора, а тоді
   * зателефонує — і розмова почнеться з образи.
   */
  try {
    const { notifyOnce, orderMovedText, ORDER_MOVED } = await import('@/lib/customer-notify')
    const from = order.delivery_date as string
    await notifyOnce(service, created.id as string, ORDER_MOVED,
      o => orderMovedText(o, from))
  } catch (e) {
    console.error('notify moved failed:', e instanceof Error ? e.message : e)
  }

  return {
    orderId: created.id as string,
    number: reserved.number,
    dealId,
    note: freed ? null : 'Старий рядок у журналі звільнити не вдалося — перевірте вручну',
  }
}

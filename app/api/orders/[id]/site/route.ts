import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor, logOrderEvent } from '@/lib/order-events'
import { broadcastOrderChange } from '@/lib/order-broadcast'
import { notifyIntegrations } from '@/lib/integration-webhooks'
import { isValidSlot } from '@/lib/delivery-slots'
import { resolveAddress } from '@/lib/delivery-zones'
import { withDelivery, isDeliveryLine } from '@/lib/delivery-fee'
import { sendOrderSheet } from '@/lib/bitrix-chat'
import { relocateOrder } from '@/lib/order-relocate'
import { orderTotal, lineTotal, manualWeight, type ManualLine } from '@/lib/manual-orders'
import { pushOrderToBitrix } from '@/lib/bitrix-deal'
import { bitrixConfigured } from '@/lib/bitrix'
import { orderSource } from '@/lib/order-source'

/** GET — замовлення з позиціями, щоб було що правити. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!await currentActor()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  const service = createServiceClient()

  const [{ data: order }, { data: items }] = await Promise.all([
    service.from('orders')
      .select('id, external_id, platform, status, address, warehouse, delivery_zone, delivery_date, delivery_slot, customer_name, customer_phone, total, bitrix_deal_id')
      .eq('id', id).single(),
    service.from('order_items')
      .select('id, position, title, unit, unit_weight, price_per_unit, ordered_qty, ordered_pieces, order_unit, product_id, bitrix_product_id')
      .eq('order_id', id).eq('removed', false).order('position'),
  ])

  if (!order) return NextResponse.json({ error: 'Замовлення не знайдено' }, { status: 404 })
  return NextResponse.json({ order, items: items ?? [] })
}

/**
 * PATCH /api/orders/<id>/site — правка замовлення з сайту або телефону.
 *
 * Міняти можна склад замовлення, адресу, склад і період доставки. Після
 * правки замовлення йде в Бітрікс тим самим шляхом, яким туди потрапляє
 * нове: угода оновлюється, позиції перезаписуються. Інакше CRM показувала б
 * операторові те, чого вже немає.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await currentActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => null) as {
    recheck?: boolean
    address?: string
    warehouse?: string | null
    delivery_date?: string | null
    delivery_slot?: string | null
    lines?: ManualLine[]
    /** false — оператор прибрав рядок доставки свідомо */
    delivery_fee?: boolean
  } | null

  const service = createServiceClient()
  const { data: order } = await service
    .from('orders').select('id, platform, address, warehouse, delivery_zone, delivery_date, delivery_slot, bitrix_deal_id, manual_number, number_source, customer_name, status, chat_sent_at')
    .eq('id', id).single()

  if (!order) return NextResponse.json({ error: 'Замовлення не знайдено' }, { status: 404 })
  if (orderSource(order.platform) !== 'site') {
    return NextResponse.json(
      { error: 'Так правляться лише замовлення з сайту й телефону' }, { status: 409 },
    )
  }

  /**
   * Повторна перевірка — коли оператор щойно виправив те, на що скаржився
   * огляд. Знімаємо позначку, і найближчий прохід візьме замовлення знову.
   */
  if (body?.recheck) {
    await service.from('orders')
      .update({ auto_done_at: null, auto_problem: null })
      .eq('id', id)
    return NextResponse.json({ ok: true, recheck: true })
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  const changes: Record<string, unknown> = {}

  const address = body?.address?.trim()
  if (address && address !== order.address) {
    patch.address = address
    changes.address = address

    // Нова адреса — новий склад: зона вираховується з неї, і лишити старий
    // склад означало б відправити замовлення не туди, куди його тепер везуть
    try {
      const zone = await resolveAddress(service, address)
      patch.delivery_zone = zone.zone
      if (zone.warehouse) {
        patch.warehouse = zone.warehouse
        changes.warehouse = zone.warehouse
      }
    } catch {
      // Геокодер мовчить — зону перерахує найближчий огляд
    }
  }

  // Склад, названий людиною, важить більше за вирахуваний з адреси
  if (body?.warehouse !== undefined && body.warehouse !== order.warehouse) {
    patch.warehouse = body.warehouse
    changes.warehouse = body.warehouse

    /*
     * Вибір людини закріплюється.
     *
     * Інакше огляд, який запускається після правки, перераховує склад з
     * адреси й повертає свій — і виглядає це так, ніби склад не
     * зберігається. Оператор бачить те, чого не бачить геокодер.
     */
    patch.warehouse_pinned = true

    /*
     * Бланк має піти на новий склад.
     *
     * Старий його вже отримав, і там замовлення чекатимуть дарма — але
     * мовчання для нового складу гірше: він про замовлення не дізнається
     * узагалі.
     */
    if (order.chat_sent_at) {
      patch.chat_sent_at = null
      changes.chat_resend = true
    }
  }

  if (body?.delivery_slot && body.delivery_slot !== order.delivery_slot) {
    if (!isValidSlot(body.delivery_slot)) {
      return NextResponse.json({ error: 'Невідомий період доставки' }, { status: 400 })
    }
    patch.delivery_slot = body.delivery_slot
    changes.delivery_slot = body.delivery_slot
  }

  // Позиції переписуються цілком: склад замовлення — це те, що оператор
  // бачить на екрані, а не різниця між двома списками
  if (body?.lines) {
    const goods = body.lines.filter(l => l.title?.trim() && Number(l.qty) > 0)
    if (!goods.length) {
      return NextResponse.json({ error: 'У замовленні має лишитись хоч один товар' }, { status: 400 })
    }

    /*
     * Видалену доставку не повертаємо.
     *
     * `withDelivery` дораховує рядок доставки за порогом суми — і це
     * правильно, поки оператор його не чіпав. Але якщо він прибрав цей
     * рядок свідомо (доставка Новою поштою, самовивіз, домовились
     * окремо), дописати його назад означає сперечатися з людиною, яка
     * щойно говорила з покупцем: рядок зникав з екрана й повертався
     * після збереження, і виглядало це як поламане видалення.
     *
     * Про це каже саме форма, а не наявність рядка у списку: вона шле
     * самі товари, і доставку серед них не видно ні тоді, коли її
     * прибрали, ні тоді, коли її просто не передають.
     */
    const keepFee = body.delivery_fee !== false || body.lines.some(isDeliveryLine)
    const lines = keepFee ? withDelivery(goods) : goods
    patch.total = orderTotal(lines)
    patch.weight = manualWeight(goods)
    patch.items = lines
      .map(l => `${l.title}, ${l.qty} ${l.unit} x ${l.price_per_unit} грн`).join('\n')

    const source = order.platform === 'manual' ? 'manual' : 'site'
    await service.from('order_items').delete().eq('order_id', id)
    await service.from('order_items').insert(lines.map((l, i) => ({
      order_id: id,
      position: i,
      source,
      product_id: l.product_id ?? null,
      bitrix_product_id: l.bitrix_product_id ?? null,
      title: l.title.trim(),
      unit: l.unit || 'шт',
      unit_weight: Number(l.unit_weight ?? 0),
      price_per_unit: Number(l.price_per_unit ?? 0),
      ordered_qty: Number(l.qty),
      // Штуки зберігаємо окремо: клієнт замовив саме їх, а не вагу
      order_unit: l.order_unit ?? null,
      ordered_pieces: l.order_unit === 'шт' ? Number(l.pieces ?? 0) || null : null,
      ordered_total: lineTotal(l),
      removed: false,
    })))

    changes.lines = lines.length
    changes.total = patch.total
  }

  /**
   * Правка — привід оглянути заново.
   *
   * Оператор щойно виправив адресу чи склад замовлення; попередній висновок
   * огляду стосувався інших даних і більше нічого не описує.
   */
  if (Object.keys(changes).length) patch.auto_done_at = null

  await service.from('orders').update(patch).eq('id', id)
  await logOrderEvent(service, id, 'items', { details: changes }, actor)

  const crm = bitrixConfigured() && order.bitrix_deal_id
    ? await pushOrderToBitrix(service, id)
    : null

  // Склад змінився, а бланк уже був надісланий — новий склад має його
  // отримати зараз, а не чекати на наступну зміну статусу
  if (changes.chat_resend) await sendOrderSheet(service, id)

  /*
   * Перенесення на інший день — не правка, а переїзд.
   *
   * Змінена дата в тій самій угоді для 1С не існує: вона забирає
   * замовлення один раз, і комплектувальники нового дня його не бачать.
   * Тому на новий день народжується окреме замовлення зі своїм номером і
   * своєю угодою, а старе закривається.
   *
   * Робиться це останнім, уже після решти правок: людина часто міняє
   * дату разом з адресою чи складом, і нове замовлення має поїхати з
   * виправленими даними, а не з тими, що були до правки.
   */
  if (body?.delivery_date && body.delivery_date !== order.delivery_date) {
    const moved = await relocateOrder(service, { orderId: id, toDate: body.delivery_date })
    if ('error' in moved) {
      return NextResponse.json({
        error: `Правки збережено, але перенести не вдалося: ${moved.error}`,
      }, { status: 409 })
    }

    await logOrderEvent(service, id, 'items', {
      details: { moved_to: body.delivery_date, number: moved.number },
    }, actor)
    await broadcastOrderChange(moved.orderId, 'sync')

    return NextResponse.json({
      ok: true,
      changes,
      moved: { order_id: moved.orderId, number: moved.number, date: body.delivery_date },
      number_note: moved.note,
    })
  }

  await broadcastOrderChange(id, 'items')
  await notifyIntegrations(id, 'order.items_changed', service)

  return NextResponse.json({
    ok: true,
    changes,
    crm_error: crm && 'error' in crm ? crm.error : null,
  })
}

import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor, logOrderEvent } from '@/lib/order-events'
import {
  buildLine, indexCatalog, correctedTotal, effectivePacks, effectiveQty, orderTotals,
  type CatalogProduct, type MarketplaceLine, type OrderLine,
} from '@/lib/order-items'
import { canPushToMaudau, pushOrderItems, type PushResult } from '@/lib/maudau-order-sync'
import { broadcastOrderChange } from '@/lib/order-broadcast'
import { canEditItems } from '@/lib/order-statuses'

type Service = ReturnType<typeof createServiceClient>

async function loadCatalog(service: Service) {
  const { data } = await service
    .from('products')
    .select('id, name, sku, external_id, price, attributes')
    .limit(5000)
  return indexCatalog((data ?? []) as CatalogProduct[])
}

/** The order's lines as the marketplace sent them. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function marketplaceLines(order: any): MarketplaceLine[] {
  const out: MarketplaceLine[] = []

  if (order.platform === 'maudau') {
    for (const parcel of order.raw?.parcels ?? []) {
      for (const it of parcel.items ?? []) {
        out.push({
          itemId: it.id != null ? String(it.id) : null,
          externalId: it.product?.external_id ?? null,
          title: it.product?.title_uk || it.product?.title || 'Без назви',
          unitPrice: (it.price ?? 0) / 100,   // MauDau quotes kopecks
          quantity: Number(it.quantity ?? 1),
        })
      }
    }
  } else if (order.platform === 'rozetka') {
    for (const p of order.raw?.purchases ?? []) {
      out.push({
        itemId: p.id != null ? String(p.id) : null,
        externalId: p.item?.article ?? p.item_id != null ? String(p.item?.article ?? p.item_id) : null,
        title: p.item_name || 'Без назви',
        unitPrice: Number(p.price_with_discount ?? p.price ?? 0),
        quantity: Number(p.quantity ?? 1),
      })
    }
  }
  return out
}

/** Materialises the lines on first open; afterwards the stored copy wins. */
async function ensureLines(service: Service, orderId: string): Promise<OrderLine[]> {
  const { data: stored } = await service
    .from('order_items').select('*').eq('order_id', orderId).order('position')

  if (stored && stored.length) return stored as unknown as OrderLine[]

  const { data: order } = await service
    .from('orders').select('id, platform, raw').eq('id', orderId).single()
  if (!order) return []

  const catalog = await loadCatalog(service)
  const lines = marketplaceLines(order).map((l, i) => buildLine(l, catalog, i))
  if (!lines.length) return []

  const { data: inserted, error } = await service
    .from('order_items')
    .insert(lines.map(l => ({ ...l, order_id: orderId })))
    .select('*')

  if (error) {
    console.error('ensureLines insert failed:', error.message)
    return lines
  }
  return (inserted ?? []) as unknown as OrderLine[]
}

// GET /api/orders/[id]/items
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await currentActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const service = createServiceClient()
  const lines = await ensureLines(service, id)

  return NextResponse.json({
    lines: lines.map(l => ({ ...l, corrected_total: correctedTotal(l) })),
    totals: orderTotals(lines),
  })
}

// PATCH /api/orders/[id]/items — save corrections
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await currentActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json() as {
    lines?: { id: string; actual_qty?: number | null; removed?: boolean }[]
    add?: { product_id: string; qty: number }[]
  }

  const service = createServiceClient()

  // An agreed order has been promised to somebody; its contents are settled.
  // Checked here as well as hidden in the interface, since a hidden button is
  // not a rule.
  const { data: order } = await service
    .from('orders').select('status').eq('id', id).single()
  if (!canEditItems(order?.status as string)) {
    return NextResponse.json(
      { error: `Замовлення у статусі «${order?.status}» — позиції вже не редагуються` },
      { status: 409 },
    )
  }

  // Snapshot first — the journal needs before/after per line, not just a total
  const { data: prior } = await service
    .from('order_items').select('*').eq('order_id', id).order('position')
  const beforeById = new Map(
    ((prior ?? []) as unknown as OrderLine[]).map(l => [l.id!, l])
  )

  // Existing lines: only the two fields an operator may touch
  for (const patch of body.lines ?? []) {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if ('actual_qty' in patch) {
      const q = patch.actual_qty
      updates.actual_qty = q == null || Number.isNaN(Number(q)) ? null : Number(q)
    }
    if ('removed' in patch) updates.removed = !!patch.removed
    await service.from('order_items').update(updates).eq('id', patch.id).eq('order_id', id)
  }

  // New lines picked from our catalogue
  if (body.add?.length) {
    const { data: products } = await service
      .from('products')
      .select('id, name, sku, external_id, price, attributes')
      .in('id', body.add.map(a => a.product_id))

    const { data: existing } = await service
      .from('order_items').select('position').eq('order_id', id)
    let position = Math.max(0, ...(existing ?? []).map(r => r.position ?? 0)) + 1

    const rows = body.add.map(a => {
      const p = (products ?? []).find(x => x.id === a.product_id) as CatalogProduct | undefined
      if (!p) return null
      const attr = p.attributes?.['Одиниця']?.toLowerCase()
      const unit = attr === 'кг' || attr === 'л' ? 'кг' : 'шт'
      const min = parseFloat(p.attributes?.['Мін'] ?? '')
      const unitWeight = unit === 'кг' && Number.isFinite(min) && min > 0 ? min : 1
      return {
        order_id: id,
        position: position++,
        source: 'manual',
        marketplace_item_id: null,
        product_external_id: p.external_id,
        product_id: p.id,
        title: p.name,
        unit,
        unit_weight: unitWeight,
        marketplace_unit_price: null,
        marketplace_qty: null,
        // Added by us, so the marketplace never charged anything for it
        ordered_total: 0,
        price_per_unit: Number(p.price ?? 0),
        ordered_qty: a.qty,
        actual_qty: null,
        removed: false,
      }
    }).filter((r): r is NonNullable<typeof r> => r !== null)

    if (rows.length) await service.from('order_items').insert(rows)
  }

  const { data: after } = await service
    .from('order_items').select('*').eq('order_id', id).order('position')
  const lines = (after ?? []) as unknown as OrderLine[]
  const totals = orderTotals(lines)

  const push = await pushToMarketplace(service, id, lines, actor)

  // Per-line detail, so a correction can be audited long after the fact
  const changes = lines.flatMap(l => {
    const was = beforeById.get(l.id!)
    const wasQty = was ? effectiveQty(was) : null
    const nowQty = effectiveQty(l)
    const added = !was
    const removedNow = l.removed && !(was?.removed ?? false)
    const restored = !l.removed && (was?.removed ?? false)
    if (!added && !removedNow && !restored && wasQty === nowQty) return []
    return [{
      title: l.title,
      unit: l.unit,
      kind: added ? 'added' : removedNow ? 'removed' : restored ? 'restored' : 'qty',
      from: wasQty,
      to: l.removed ? 0 : nowQty,
      sum_from: was ? correctedTotal(was) : 0,
      sum_to: correctedTotal(l),
    }]
  })

  await logOrderEvent(service, id, 'items',
    {
      old: `₴${totals.ordered}`,
      new: `₴${totals.corrected}`,
      details: { changes, totals, push: push ?? null },
    },
    actor,
  )

  await broadcastOrderChange(id, 'items')

  return NextResponse.json({
    lines: lines.map(l => ({ ...l, corrected_total: correctedTotal(l) })),
    totals,
    push,
  })
}


/**
 * Mirrors the correction onto the marketplace. MauDau recalculates the order
 * total and our commission from the quantities it receives.
 *
 * Lines we added ourselves have no marketplace id, and removals are left out
 * until we know how MauDau expects them — sending quantity 0 is untested.
 */
async function pushToMarketplace(
  service: Service,
  orderId: string,
  lines: OrderLine[],
  actor: { id: string; name: string } | null,
): Promise<(PushResult & { platform?: string }) | null> {
  const { data: order } = await service
    .from('orders').select('platform, external_id').eq('id', orderId).single()
  if (!order) return null

  if (order.platform !== 'maudau') {
    return { ok: false, platform: order.platform, error: 'Відправка налаштована лише для MauDau' }
  }
  if (!canPushToMaudau()) {
    return { ok: false, error: 'MAUDAU_CABINET_TOKEN не налаштовано у середовищі' }
  }

  const sendable = lines
    .filter(l => l.source === 'marketplace' && !l.removed && l.marketplace_item_id)
    .map(l => ({
      itemId: l.marketplace_item_id as string,
      // The corrected figure is already a pack count — the unit MauDau takes
      quantity: effectivePacks(l),
    }))

  if (!sendable.length) return null

  const marketplaceOrderId = (order.external_id ?? '').replace(/^MD-/, '')
  const result = await pushOrderItems(marketplaceOrderId, sendable)

  await logOrderEvent(
    service, orderId, 'marketplace_push',
    {
      new: result.ok
        ? `MauDau: сума ₴${result.total}, комісія ₴${result.commission}` +
          (result.skipped?.length ? ` · ${result.skipped.length} позицій не передано` : '')
        : `не вдалося — ${result.error}`,
    },
    actor,
  )

  return result
}

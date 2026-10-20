import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor } from '@/lib/order-events'
import { getCurrentRole, canAccess } from '@/lib/getRole'

/**
 * Категорії цін фіда.
 *
 * Одна відповідь на питання «яку ціну віддавати цьому майданчику»: за
 * замовчуванням для всього фіда, і точковою — для категорії товарів чи
 * окремого товару.
 */
async function guard() {
  const actor = await currentActor()
  const role = await getCurrentRole()
  return actor && canAccess('feeds', role) ? actor : null
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!await currentActor()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  const service = createServiceClient()

  const [{ data: categories }, { data: feed }, { data: assigned }] = await Promise.all([
    service.from('price_categories')
      .select('id, name, source, bitrix_price_type_id, multiplier, is_system, note')
      .order('is_system', { ascending: false }).order('name'),
    service.from('feeds').select('price_category_id').eq('id', id).single(),
    service.from('feed_products')
      .select('price_category_id')
      .eq('feed_id', id).not('price_category_id', 'is', null),
  ])

  // Скільки товарів має власну категорію — щоб було видно, що фід не
  // однорідний, не перебираючи його рядок за рядком
  const perProduct = new Map<string, number>()
  for (const row of assigned ?? []) {
    const key = row.price_category_id as string
    perProduct.set(key, (perProduct.get(key) ?? 0) + 1)
  }

  return NextResponse.json({
    categories: categories ?? [],
    feed_category_id: feed?.price_category_id ?? null,
    per_product: [...perProduct].map(([category_id, count]) => ({ category_id, count })),
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await guard()
  if (!actor) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => null) as {
    action?: 'create' | 'feed' | 'scope'
    name?: string
    multiplier?: number
    source?: 'site' | 'bitrix'
    bitrix_price_type_id?: number | null
    category_id?: string | null
    scope?: 'all' | 'category' | 'product'
    category_name?: string | null
    product_id?: string | null
  } | null

  const service = createServiceClient()

  if (body?.action === 'create') {
    const name = body.name?.trim()
    const multiplier = Number(body.multiplier)
    if (!name) return NextResponse.json({ error: 'Вкажіть назву' }, { status: 400 })
    // Нульовий чи від'ємний коефіцієнт перетворює фід на порожні ціни
    if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 100) {
      return NextResponse.json({ error: 'Коефіцієнт — число більше нуля' }, { status: 400 })
    }

    const { data, error } = await service.from('price_categories').insert({
      name,
      source: body.source === 'bitrix' ? 'bitrix' : 'site',
      bitrix_price_type_id: body.bitrix_price_type_id ?? null,
      multiplier,
      created_by: actor.id,
    }).select('id').single()

    if (error) {
      return NextResponse.json(
        { error: error.message.includes('duplicate') ? 'Така назва вже є' : error.message },
        { status: 400 },
      )
    }
    return NextResponse.json({ ok: true, id: data?.id })
  }

  if (body?.action === 'feed') {
    await service.from('feeds')
      .update({ price_category_id: body.category_id ?? null, updated_at: new Date().toISOString() })
      .eq('id', id)
    return NextResponse.json({ ok: true })
  }

  if (body?.action === 'scope') {
    const value = body.category_id ?? null

    if (body.scope === 'all') {
      // Знімаємо точкові призначення: загальне правило фіда має діяти всюди,
      // інакше після «застосувати до всіх» частина товарів лишалась би зі
      // старою категорією, і зрозуміти чому було б нізвідки
      await service.from('feed_products')
        .update({ price_category_id: null }).eq('feed_id', id)
      await service.from('feeds')
        .update({ price_category_id: value, updated_at: new Date().toISOString() })
        .eq('id', id)
      return NextResponse.json({ ok: true, applied: 'all' })
    }

    if (body.scope === 'product' && body.product_id) {
      await service.from('feed_products')
        .update({ price_category_id: value })
        .eq('feed_id', id).eq('product_id', body.product_id)
      return NextResponse.json({ ok: true, applied: 1 })
    }

    if (body.scope === 'category' && body.category_name) {
      const { data: products } = await service
        .from('products').select('id').eq('category_name', body.category_name)
      const ids = (products ?? []).map(p => p.id as string)
      if (!ids.length) return NextResponse.json({ ok: true, applied: 0 })

      await service.from('feed_products')
        .update({ price_category_id: value })
        .eq('feed_id', id).in('product_id', ids)
      return NextResponse.json({ ok: true, applied: ids.length })
    }
  }

  return NextResponse.json({ error: 'Невідома дія' }, { status: 400 })
}

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor } from '@/lib/order-events'
import { getCurrentRole, canAccess } from '@/lib/getRole'

/**
 * Штучні акції фіда.
 *
 * Правило міняє те, від чого відлічують знижку на вітрині маркетплейсу, тож
 * заводити його може той, хто відповідає за фіди, а не кожен, хто їх бачить.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!await currentActor()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  const service = createServiceClient()

  const { data } = await service
    .from('price_promos')
    .select('id, feed_id, scope, category_name, product_id, mode, value, active, note, created_at, product:products(name)')
    .or(`feed_id.eq.${id},feed_id.is.null`)
    .order('created_at', { ascending: false })

  return NextResponse.json({ promos: data ?? [] })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await currentActor()
  const role = await getCurrentRole()
  if (!actor || !canAccess('feeds', role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json().catch(() => null) as {
    scope?: 'all' | 'category' | 'product'
    category_name?: string | null
    product_id?: string | null
    mode?: 'percent' | 'amount'
    value?: number
    note?: string | null
  } | null

  if (!body?.scope || !body.mode || !(Number(body.value) > 0)) {
    return NextResponse.json({ error: 'Вкажіть, на що й наскільки піднімати' }, { status: 400 })
  }
  if (body.scope === 'category' && !body.category_name) {
    return NextResponse.json({ error: 'Оберіть категорію' }, { status: 400 })
  }
  if (body.scope === 'product' && !body.product_id) {
    return NextResponse.json({ error: 'Оберіть товар' }, { status: 400 })
  }
  // Відсоток понад сотню малює знижку, в яку ніхто не повірить
  if (body.mode === 'percent' && Number(body.value) > 90) {
    return NextResponse.json({ error: 'Відсоток — до 90' }, { status: 400 })
  }

  const service = createServiceClient()

  /**
   * Правило на ту саму ціль замінюємо, а не додаємо друге.
   *
   * Через upsert це не виходить: унікальність тут часткова — вона діє лише
   * в межах одного різновиду правил, — а такий індекс Postgres для ON
   * CONFLICT не бере. Тому прибираємо попереднє самі.
   */
  let existing = service.from('price_promos').delete().eq('feed_id', id).eq('scope', body.scope)

  if (body.scope === 'product') existing = existing.eq('product_id', body.product_id!)
  else if (body.scope === 'category') existing = existing.eq('category_name', body.category_name!)

  await existing

  const { data, error } = await service.from('price_promos').insert({
    feed_id: id,
    scope: body.scope,
    category_name: body.scope === 'category' ? body.category_name : null,
    product_id: body.scope === 'product' ? body.product_id : null,
    mode: body.mode,
    value: Number(body.value),
    note: body.note?.trim() || null,
    active: true,
    created_by: actor.id,
  }).select('id').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true, id: data?.id })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const role = await getCurrentRole()
  if (!await currentActor() || !canAccess('feeds', role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const promoId = new URL(req.url).searchParams.get('promo')
  if (!promoId) return NextResponse.json({ error: 'Не вказано правило' }, { status: 400 })

  const { id } = await params
  await createServiceClient()
    .from('price_promos').delete().eq('id', promoId).eq('feed_id', id)

  return NextResponse.json({ ok: true })
}

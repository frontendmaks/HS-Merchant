import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor } from '@/lib/order-events'
import { getCurrentRole, canAccess } from '@/lib/getRole'
import { extractAmount, pricePerKg, ourPricePerKg, unitGrams } from '@/lib/price-monitor'
import { contextLabel } from '@/lib/meat-context'

/**
 * A competitor price entered by a person.
 *
 * For shops that refuse to be read at all. The price is converted to per
 * kilogram by the same rules the crawler uses, so a typed row and a fetched one
 * are comparable — otherwise the manual ones would quietly sit on a different
 * basis and skew every average they took part in.
 */
export async function POST(req: NextRequest) {
  const actor = await currentActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canAccess('priceMonitor', await getCurrentRole())) {
    return NextResponse.json({ error: 'Немає доступу' }, { status: 403 })
  }

  const { productId, competitorId, title, price, url, unit } = await req.json() as {
    productId: string; competitorId: string
    title: string; price: number; url?: string; unit?: string
  }

  if (!productId || !competitorId) {
    return NextResponse.json({ error: 'Оберіть товар і конкурента' }, { status: 400 })
  }
  const value = Number(price)
  if (!Number.isFinite(value) || value <= 0) {
    return NextResponse.json({ error: 'Вкажіть ціну' }, { status: 400 })
  }
  if (!title?.trim()) {
    return NextResponse.json({ error: 'Вкажіть назву позиції у конкурента' }, { status: 400 })
  }

  const service = createServiceClient()
  const { data: product } = await service
    .from('products').select('name, price').eq('id', productId).single()

  if (!product) return NextResponse.json({ error: 'Товар не знайдено' }, { status: 404 })

  const ourAmount = extractAmount(product.name as string)
  const theirAmount = extractAmount(title)
  // «за кг» / «за 200 г» as the person stated it, else the weight in the name,
  // else the same default our own prices use: a weight good is priced per kilo
  const basis = unitGrams(unit ?? '') ?? theirAmount
  const perKg = basis ? pricePerKg(value, basis) : value

  const { error } = await service.from('price_matches').upsert({
    product_id: productId,
    competitor_id: competitorId,
    competitor_title: title.trim().slice(0, 200),
    competitor_url: url?.trim() || `#${title.trim().slice(0, 100)}`,
    price: value,
    price_per_kg: perKg,
    our_price_per_kg: ourPricePerKg(Number(product.price ?? 0), ourAmount),
    our_amount: ourAmount,
    competitor_amount: theirAmount,
    unit_label: unit?.trim() || null,
    context_label: contextLabel(title) || null,
    similarity: 1,
    status: 'confirmed',
    is_chosen: true,
    is_manual: true,
    manual_by: actor.id,
    manual_at: new Date().toISOString(),
    checked_at: new Date().toISOString(),
    error: null,
  }, { onConflict: 'product_id,competitor_id,competitor_url' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, pricePerKg: perKg })
}

export async function DELETE(req: NextRequest) {
  if (!await currentActor()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canAccess('priceMonitor', await getCurrentRole())) {
    return NextResponse.json({ error: 'Немає доступу' }, { status: 403 })
  }
  const id = req.nextUrl.searchParams.get('id') ?? ''
  const { error } = await createServiceClient()
    .from('price_matches').delete().eq('id', id).eq('is_manual', true)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

/**
 * Asking for products to be taken out of sale.
 *
 *   GET   — the requests, newest first
 *   POST  { productIds, reason } — raise one
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor } from '@/lib/order-events'
import { MIN_REMOVAL_REASON, canDecideRemoval } from '@/lib/product-removal'

export async function GET() {
  const actor = await currentActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('product_removal_requests')
    .select(`*,
      author:profiles!product_removal_requests_created_by_fkey(id, full_name, email),
      decider:profiles!product_removal_requests_decided_by_fkey(id, full_name, email),
      items:product_removal_items(product_id, product_name)`)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ requests: data ?? [] })
}

export async function POST(req: NextRequest) {
  const actor = await currentActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { productIds, reason, feedIds } = await req.json() as {
    productIds?: string[]
    reason?: string
    /** Empty or absent means every feed the product is in */
    feedIds?: string[]
  }

  const ids = [...new Set((productIds ?? []).filter(Boolean))]
  if (!ids.length) {
    return NextResponse.json({ error: 'Оберіть хоча б один товар' }, { status: 400 })
  }
  const text = (reason ?? '').trim()
  if (text.length < MIN_REMOVAL_REASON) {
    return NextResponse.json(
      { error: `Опишіть причину — щонайменше ${MIN_REMOVAL_REASON} символів` },
      { status: 400 },
    )
  }

  const supabase = createServiceClient()

  // Names are copied in rather than joined later: a product renamed after the
  // fact would otherwise rewrite what the request was asking for
  const { data: products } = await supabase
    .from('products').select('id, name, withdrawn_at').in('id', ids)

  const found = products ?? []
  if (!found.length) {
    return NextResponse.json({ error: 'Товари не знайдено' }, { status: 400 })
  }
  const already = found.filter(p => p.withdrawn_at)
  if (already.length === found.length) {
    return NextResponse.json(
      { error: 'Усі обрані товари вже зняті з продажу' }, { status: 400 })
  }

  const { data: request, error } = await supabase
    .from('product_removal_requests')
    .insert({
      created_by: actor.id,
      reason: text,
      feed_ids: [...new Set((feedIds ?? []).filter(Boolean))],
    })
    .select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { error: itemsError } = await supabase.from('product_removal_items').insert(
    found
      .filter(p => !p.withdrawn_at)
      .map(p => ({ request_id: request.id, product_id: p.id, product_name: p.name })),
  )
  if (itemsError) {
    // A request with no products is a request for nothing — take it back out
    await supabase.from('product_removal_requests').delete().eq('id', request.id)
    return NextResponse.json({ error: itemsError.message }, { status: 500 })
  }

  await supabase.from('product_removal_events').insert({
    request_id: request.id, actor_id: actor.id, actor_name: actor.name,
    type: 'created', new_value: `${found.length} тов.`,
  })

  await notifyDeciders(supabase, actor.name, found.length, request.id)

  return NextResponse.json({ ok: true, id: request.id, skipped: already.length })
}

type Service = ReturnType<typeof createServiceClient>

/** Whoever may decide needs to know there is something waiting. */
async function notifyDeciders(
  supabase: Service, author: string, count: number, requestId: string,
) {
  const { data: people } = await supabase
    .from('profiles').select('id, role').eq('is_active', true)
  const deciders = (people ?? []).filter(p => canDecideRemoval(p.role as string))
  if (!deciders.length) return

  await supabase.from('notifications').insert(deciders.map(p => ({
    user_id: p.id,
    type: 'product_removal',
    title: 'Запит на зняття товарів з продажу',
    body: `${author} · ${count} ${count === 1 ? 'товар' : 'товарів'}`,
    link: `/products/removals#${requestId}`,
  })))
}

export const dynamic = 'force-dynamic'

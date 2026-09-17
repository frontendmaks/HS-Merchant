/**
 * Deciding a removal request.
 *
 *   PATCH { decision: 'approve' | 'reject' | 'cancel', note? }
 *
 * Approval is the only thing here that changes what customers see, and what it
 * changes is narrow on purpose: the products stop being sellable. Their offers
 * stay in every feed, marked out of stock — see lib/product-removal.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor } from '@/lib/order-events'
import { getCurrentRole } from '@/lib/getRole'
import { canDecideRemoval } from '@/lib/product-removal'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await currentActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { decision, note } = await req.json() as {
    decision: 'approve' | 'reject' | 'cancel'
    note?: string
  }

  const supabase = createServiceClient()
  const { data: request } = await supabase
    .from('product_removal_requests')
    .select('id, status, created_by, reason')
    .eq('id', id).maybeSingle()

  if (!request) return NextResponse.json({ error: 'Запит не знайдено' }, { status: 404 })
  if (request.status !== 'pending') {
    return NextResponse.json({ error: 'Запит уже опрацьовано' }, { status: 409 })
  }

  const role = await getCurrentRole()

  // Withdrawing a request is the author's own business; deciding one is not
  if (decision === 'cancel') {
    if (request.created_by !== actor.id) {
      return NextResponse.json({ error: 'Скасувати може лише автор' }, { status: 403 })
    }
  } else if (!canDecideRemoval(role)) {
    return NextResponse.json({ error: 'Рішення ухвалює адміністратор' }, { status: 403 })
  }

  const status = decision === 'approve' ? 'approved'
    : decision === 'reject' ? 'rejected' : 'canceled'

  const { data: items } = await supabase
    .from('product_removal_items').select('product_id, product_name').eq('request_id', id)
  const productIds = (items ?? []).map(i => i.product_id as string)

  if (decision === 'approve' && productIds.length) {
    // Which feeds each product is in right now, so putting it back later
    // restores exactly those and nothing else
    const { data: memberships } = await supabase
      .from('feed_products')
      .select('feed_id, product_id')
      .in('product_id', productIds)
      .eq('is_active', true)

    const feedsOf = new Map<string, string[]>()
    for (const m of memberships ?? []) {
      const pid = m.product_id as string
      feedsOf.set(pid, [...(feedsOf.get(pid) ?? []), m.feed_id as string])
    }

    const withdrawnAt = new Date().toISOString()
    for (const productId of productIds) {
      const { error } = await supabase
        .from('products')
        .update({
          withdrawn_at: withdrawnAt,
          withdrawn_by: actor.id,
          withdrawn_reason: request.reason,
          withdrawn_feed_ids: feedsOf.get(productId) ?? [],
          updated_at: withdrawnAt,
        })
        .eq('id', productId)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Out of the feeds themselves: the offer stops being generated, which is
    // what "зняти з продажу" was asked to mean
    if (memberships?.length) {
      const { error } = await supabase
        .from('feed_products')
        .update({ is_active: false, updated_at: withdrawnAt })
        .in('product_id', productIds)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  const { error: saveError } = await supabase
    .from('product_removal_requests')
    .update({
      status,
      decided_by: actor.id,
      decided_at: new Date().toISOString(),
      decision_note: note?.trim() || null,
    })
    .eq('id', id)
  if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 })

  if (decision !== 'cancel') {
    const verdict = decision === 'approve' ? 'підтверджено' : 'відхилено'
    await supabase.from('notifications').insert({
      user_id: request.created_by,
      type: 'product_removal',
      title: `Запит на зняття з продажу ${verdict}`,
      body: [`${productIds.length} тов.`, note?.trim()].filter(Boolean).join(' · '),
      link: `/products/removals#${id}`,
    })
  }

  return NextResponse.json({ ok: true, status, products: productIds.length })
}

export const dynamic = 'force-dynamic'

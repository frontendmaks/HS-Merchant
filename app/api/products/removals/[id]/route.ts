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
import {
  canDecideRemoval, canEditRemoval, MIN_REMOVAL_REASON,
} from '@/lib/product-removal'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await currentActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json() as {
    decision?: 'approve' | 'reject' | 'cancel'
    note?: string
    /** Editing a request that has not been decided yet */
    reason?: string
    productIds?: string[]
    feedIds?: string[]
  }
  const { decision, note } = body

  const supabase = createServiceClient()
  const { data: request } = await supabase
    .from('product_removal_requests')
    .select('id, status, created_by, reason, feed_ids')
    .eq('id', id).maybeSingle()

  if (!request) return NextResponse.json({ error: 'Запит не знайдено' }, { status: 404 })
  if (request.status !== 'pending') {
    return NextResponse.json({ error: 'Запит уже опрацьовано' }, { status: 409 })
  }

  const role = await getCurrentRole()

  // An edit, not a decision. The author corrects their own ask; whoever may
  // decide can also correct it, since they are the one acting on it.
  if (!decision) {
    if (!canEditRemoval(request.status as string)) {
      return NextResponse.json(
        { error: 'Опрацьований запит уже не редагується' }, { status: 409 })
    }
    if (request.created_by !== actor.id && !canDecideRemoval(role)) {
      return NextResponse.json({ error: 'Редагувати може автор або адміністратор' }, { status: 403 })
    }
    return await edit(supabase, id, request, body, actor)
  }

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
    // The feeds the request named, or every one the product is in
    const scope = (request.feed_ids as string[] | null) ?? []
    let membershipQuery = supabase
      .from('feed_products')
      .select('feed_id, product_id')
      .in('product_id', productIds)
      .eq('is_active', true)
    if (scope.length) membershipQuery = membershipQuery.in('feed_id', scope)

    const { data: memberships } = await membershipQuery

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
      let off = supabase
        .from('feed_products')
        .update({ is_active: false, updated_at: withdrawnAt })
        .in('product_id', productIds)
      if (scope.length) off = off.in('feed_id', scope)

      const { error } = await off
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

  await supabase.from('product_removal_events').insert({
    request_id: id, actor_id: actor.id, actor_name: actor.name,
    type: status === 'approved' ? 'approved' : status === 'rejected' ? 'rejected' : 'canceled',
    new_value: note?.trim() || null,
  })

  return NextResponse.json({ ok: true, status, products: productIds.length })
}

type Service = ReturnType<typeof createServiceClient>

/**
 * Applies a correction and writes down what changed.
 *
 * Every field is compared before it is written: a save that touched nothing
 * must not leave a line in the history saying it did, or the history stops
 * being worth reading.
 */
async function edit(
  supabase: Service,
  id: string,
  before: { reason: string; feed_ids: string[] | null },
  patch: { reason?: string; productIds?: string[]; feedIds?: string[] },
  actor: { id: string; name: string },
) {
  const events: Record<string, unknown>[] = []
  const line = (type: string, oldValue: string | null, newValue: string | null) =>
    events.push({
      request_id: id, actor_id: actor.id, actor_name: actor.name,
      type, old_value: oldValue, new_value: newValue,
    })

  if (patch.reason !== undefined) {
    const next = patch.reason.trim()
    if (next.length < MIN_REMOVAL_REASON) {
      return NextResponse.json(
        { error: `Опишіть причину — щонайменше ${MIN_REMOVAL_REASON} символів` },
        { status: 400 },
      )
    }
    if (next !== before.reason) {
      await supabase.from('product_removal_requests').update({ reason: next }).eq('id', id)
      line('reason', before.reason, next)
    }
  }

  if (patch.feedIds !== undefined) {
    const next = [...new Set(patch.feedIds.filter(Boolean))].sort()
    const was = [...(before.feed_ids ?? [])].sort()
    if (next.join() !== was.join()) {
      await supabase.from('product_removal_requests').update({ feed_ids: next }).eq('id', id)
      const name = async (ids: string[]) => {
        if (!ids.length) return 'усі маркетплейси'
        const { data } = await supabase.from('feeds').select('name').in('id', ids)
        return (data ?? []).map(f => f.name as string).join(', ')
      }
      line('feeds', await name(was), await name(next))
    }
  }

  if (patch.productIds !== undefined) {
    const next = [...new Set(patch.productIds.filter(Boolean))]
    const { data: current } = await supabase
      .from('product_removal_items').select('product_id').eq('request_id', id)
    const was = (current ?? []).map(i => i.product_id as string)

    if ([...next].sort().join() !== [...was].sort().join()) {
      if (!next.length) {
        return NextResponse.json({ error: 'Оберіть хоча б один товар' }, { status: 400 })
      }
      const { data: products } = await supabase
        .from('products').select('id, name').in('id', next)

      await supabase.from('product_removal_items').delete().eq('request_id', id)
      await supabase.from('product_removal_items').insert(
        (products ?? []).map(p => ({
          request_id: id, product_id: p.id, product_name: p.name,
        })),
      )
      line('items', `${was.length} тов.`, `${next.length} тов.`)
    }
  }

  if (events.length) await supabase.from('product_removal_events').insert(events)

  return NextResponse.json({ ok: true, changes: events.length })
}

export const dynamic = 'force-dynamic'

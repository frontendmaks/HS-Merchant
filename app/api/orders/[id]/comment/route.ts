/**
 * The operator's own note on an order.
 *
 * Deliberately the plainest route here: no marketplace call, no status
 * chain, no locking. This text never leaves us, so nothing outside can
 * refuse it and there is no order state in which writing it is wrong — an
 * order already cancelled or delivered is exactly when someone wants to
 * record why.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor, logOrderEvent } from '@/lib/order-events'
import { broadcastOrderChange } from '@/lib/order-broadcast'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const actor = await currentActor()
  if (!actor) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

  const { comment } = (await req.json()) as { comment: string }
  const next = (comment ?? '').trim() || null

  const supabase = createServiceClient()
  const { data: before } = await supabase
    .from('orders').select('operator_comment').eq('id', id).single()
  const prev = (before?.operator_comment as string | null) ?? null

  if (prev === next) return NextResponse.json({ success: true, comment: next })

  const { error } = await supabase
    .from('orders')
    .update({ operator_comment: next, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

  // Worth a journal line: a note explaining why an order stalled is the kind
  // of thing someone asks about weeks later, and "who wrote this" is half
  // the answer
  await logOrderEvent(supabase, id, 'operator_comment', { old: prev, new: next }, actor)
  await broadcastOrderChange(id, 'operator_comment')

  return NextResponse.json({ success: true, comment: next })
}

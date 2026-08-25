import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor, logOrderEvent } from '@/lib/order-events'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const { reason } = (await req.json()) as { reason: string }

  const supabase = createServiceClient()
  const { error } = await supabase
    .from('orders')
    .update({ cancel_reason: reason || null, updated_at: new Date().toISOString() })
    .eq('id', id)

  await logOrderEvent(supabase, id, 'cancel_reason', { new: reason || null }, await currentActor())

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

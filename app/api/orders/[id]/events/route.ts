import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentRole, canAccess } from '@/lib/getRole'

// GET /api/orders/[id]/events — the order's journal, oldest first
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // The journal names who did what, so it is management-only
  const role = await getCurrentRole()
  if (!canAccess('orderJournal', role)) {
    return NextResponse.json({ error: 'Немає доступу до журналу' }, { status: 403 })
  }

  const { id } = await params
  const service = createServiceClient()

  const { data, error } = await service
    .from('order_events')
    .select('id, type, old_value, new_value, details, created_at, actor_id, actor_name')
    .eq('order_id', id)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ events: data ?? [] })
}

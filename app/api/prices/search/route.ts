import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor } from '@/lib/order-events'
import { getCurrentRole, canAccess } from '@/lib/getRole'

/** Finding our own products to put under watch. */
export async function GET(req: NextRequest) {
  if (!await currentActor()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canAccess('priceMonitor', await getCurrentRole())) {
    return NextResponse.json({ error: 'Немає доступу' }, { status: 403 })
  }

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
  if (q.length < 2) return NextResponse.json({ products: [] })

  const { data } = await createServiceClient()
    .from('products')
    .select('id, name, price, category_name, stock')
    .eq('status', 'active')
    .ilike('name', `%${q.replace(/[%_]/g, '')}%`)
    .order('name')
    .limit(25)

  return NextResponse.json({ products: data ?? [] })
}

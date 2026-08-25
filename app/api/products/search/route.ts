import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor } from '@/lib/order-events'

// GET /api/products/search?q=… — catalogue lookup for adding a line to an order
export async function GET(req: NextRequest) {
  if (!await currentActor()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
  const service = createServiceClient()

  let query = service
    .from('products')
    .select('id, name, sku, price, attributes')
    .eq('status', 'active')
    .order('name')
    .limit(40)

  if (q) query = query.or(`name.ilike.%${q}%,sku.ilike.%${q}%`)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    products: (data ?? []).map(p => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      price: Number(p.price ?? 0),
      unit: (p.attributes as Record<string, string> | null)?.['Одиниця'] ?? 'шт',
    })),
  })
}

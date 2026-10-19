import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor } from '@/lib/order-events'

/**
 * GET /api/orders/manual/products?q=…
 *
 * Пошук товару для ручного замовлення.
 *
 * Шукає серед усіх товарів, а не лише активних: по телефону замовляють і те,
 * що на сайті зняте з продажу або закінчилось. Стан товару при цьому видно —
 * оператор має знати, що пропонує.
 */
export async function GET(req: NextRequest) {
  if (!await currentActor()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
  if (q.length < 2) return NextResponse.json({ products: [] })

  const safe = q.replace(/[%_,()]/g, ' ').trim()
  const service = createServiceClient()

  const { data } = await service
    .from('products')
    .select('id, name, sku, code_1c, price, stock, unit, status, category_name, attributes')
    .or(`name.ilike.%${safe}%,sku.ilike.%${safe}%,code_1c.ilike.%${safe}%`)
    // Активні першими: по телефону здебільшого замовляють те, що є
    .order('status')
    .order('name')
    .limit(40)

  const products = (data ?? []).map(p => {
    const attrs = (p.attributes as Record<string, string> | null) ?? {}
    const pack = Number(attrs['Мін'] ?? 0)
    return {
      id: p.id,
      name: p.name,
      sku: p.sku,
      code_1c: p.code_1c,
      price: Number(p.price ?? 0),
      unit: p.unit || 'шт',
      /** Крок продажу вагового товару: «0.4» означає фасування по 400 г */
      pack: pack > 0 ? pack : null,
      stock: p.stock == null ? null : Number(p.stock),
      status: p.status,
      category: p.category_name,
    }
  })

  return NextResponse.json({ products })
}

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor } from '@/lib/order-events'

/**
 * GET /api/orders/manual/products
 *
 * Увесь каталог для ручного замовлення — одним списком.
 *
 * Раніше кожне натискання клавіші йшло в базу, і підказки з'являлись із
 * затримкою, помітною в розмові з клієнтом. Товарів дві тисячі — це менше,
 * ніж одна сторінка звіту, тож дешевше віддати їх один раз і шукати на місці:
 * підказка з'являється тієї ж миті, коли оператор домовляє слово.
 *
 * Віддаємо всі, а не лише активні: по телефону замовляють і те, що на сайті
 * зняте з продажу або закінчилось. Стан товару при цьому видно — оператор має
 * знати, що пропонує.
 */

export interface CatalogueItem {
  id: string
  name: string
  sku: string | null
  code_1c: string | null
  price: number
  unit: string
  pack: number | null
  stock: number | null
  status: string
  category: string | null
}

/** Каталог змінюється раз на синхронізацію, не раз на натискання клавіші. */
const TTL_MS = 5 * 60 * 1000
let cache: { at: number; items: CatalogueItem[] } | null = null

async function catalogue(): Promise<CatalogueItem[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.items

  const service = createServiceClient()
  const { data } = await service
    .from('products')
    .select('id, name, sku, code_1c, price, stock, unit, status, category_name, attributes')
    // Активні першими: по телефону здебільшого замовляють те, що є
    .order('status')
    .order('name')

  const items = (data ?? []).map(p => {
    const attrs = (p.attributes as Record<string, string> | null) ?? {}
    const pack = Number(attrs['Мін'] ?? attrs['Крок'] ?? 0)
    return {
      id: p.id as string,
      name: p.name as string,
      sku: p.sku as string | null,
      code_1c: p.code_1c as string | null,
      price: Number(p.price ?? 0),
      /**
       * Одиниця — з атрибутів картки, не з колонки.
       *
       * У колонці `unit` в усіх товарів стоїть «шт», бо так їх рахує
       * WooCommerce. Справжня одиниця продажу — в атрибуті «Одиниця»:
       * філе продається кілограмами, консерви штуками, і замовлення на
       * «16 шт філе» замість «1.6 кг» це зовсім інша кількість.
       */
      unit: attrs['Одиниця'] || (p.unit as string) || 'шт',
      /** Крок продажу вагового товару: «0.4» означає фасування по 400 г */
      pack: pack > 0 ? pack : null,
      stock: p.stock == null ? null : Number(p.stock),
      status: p.status as string,
      category: p.category_name as string | null,
    }
  })

  cache = { at: Date.now(), items }
  return items
}

export async function GET() {
  if (!await currentActor()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json({ products: await catalogue() }, {
    // Браузер теж не має перепитувати каталог під час однієї зміни
    headers: { 'Cache-Control': 'private, max-age=300' },
  })
}

/**
 * POST /api/rozetka/upload-products
 *
 * Те саме, що робить щогодинний прохід, але на вимогу: оновити ціни й
 * залишки, а з `create: true` — ще й завести картки, яких на Rozetka
 * іще немає.
 *
 * Раніше цей маршрут жив окремим життям: брав ціну прямо з каталогу,
 * повз категорію «Маркетплейс» і повз штучну знижку, а відповідність
 * товар→картка складав у `feeds.settings` як JSON. Тепер і він, і крон
 * ходять однією дорогою — `uploadRozetkaItems`, — бо дві дороги до
 * однієї вітрини різними цінами це не зручність, а розбіжність.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { uploadRozetkaItems } from '@/lib/rozetka-run'

export const maxDuration = 300

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const result = await uploadRozetkaItems(createServiceClient(), {
      updateOnly: !body?.create,
      createLimit: Number(body?.limit ?? 60),
    })
    return NextResponse.json({ success: true, ...result })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Помилка' }, { status: 500 },
    )
  }
}

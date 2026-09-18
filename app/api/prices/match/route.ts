import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor } from '@/lib/order-events'
import { getCurrentRole, canAccess } from '@/lib/getRole'

/**
 * Рішення людини про позицію конкурента.
 *
 *   choose   — з цією й порівнюємо; її сторінка запам'ятовується, і надалі
 *              ціна читається прямо звідти, без пошуку
 *   reject   — це не той товар; рядок зникає, а відмова лишається назавжди,
 *              щоб той самий збіг не запропонували вдруге
 */
export async function PATCH(req: NextRequest) {
  const actor = await currentActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canAccess('priceMonitor', await getCurrentRole())) {
    return NextResponse.json({ error: 'Немає доступу' }, { status: 403 })
  }

  const { id, status, choose } = await req.json() as {
    id: string; status?: string; choose?: boolean
  }

  const service = createServiceClient()
  const { data: row } = await service
    .from('price_matches')
    .select('id, product_id, competitor_id, competitor_title, competitor_url')
    .eq('id', id).single()

  if (!row) return NextResponse.json({ error: 'Не знайдено' }, { status: 404 })

  if (choose || status === 'confirmed') {
    // Одна на конкурента: дві обрані позиції означали б дві ціни з одного
    // магазину, і незрозуміло, з якою ми порівнюємось
    await service.from('price_matches')
      .update({ is_chosen: false, pinned_url: null })
      .eq('product_id', row.product_id).eq('competitor_id', row.competitor_id)

    const url = String(row.competitor_url ?? '')
    const { error } = await service.from('price_matches').update({
      is_chosen: true,
      status: 'confirmed',
      // Адресу запам'ятовуємо лише справжню: «#назва» — це заглушка для
      // магазинів, які не дають посилань, і читати з неї нічого
      pinned_url: url.startsWith('http') ? url : null,
    }).eq('id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, pinned: url.startsWith('http') })
  }

  if (status === 'rejected') {
    await service.from('price_rejections').upsert({
      product_id: row.product_id,
      competitor_id: row.competitor_id,
      competitor_title: row.competitor_title ?? '',
      competitor_url: row.competitor_url,
      rejected_by: actor.id,
    }, { onConflict: 'product_id,competitor_id,competitor_title' })

    // Рядок іде геть: відмова більше не займає місця в деталях
    const { error } = await service.from('price_matches').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, removed: true })
  }

  return NextResponse.json({ error: 'Невідома дія' }, { status: 400 })
}

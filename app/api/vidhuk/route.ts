import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * Приймає відгук.
 *
 * Авторизації тут немає й бути не може: пише покупець, а не наш
 * користувач. Замість неї — токен замовлення: він довгий, випадковий і
 * відомий лише тому, кому ми його надіслали.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as {
    token?: string
    rating?: number
    comment?: string
  } | null

  const token = body?.token ?? ''
  const rating = Number(body?.rating)

  if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) {
    return NextResponse.json({ error: 'Посилання недійсне' }, { status: 400 })
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: 'Оцінка має бути від 1 до 5' }, { status: 400 })
  }

  const service = createServiceClient()
  const { data: order } = await service
    .from('orders').select('id').eq('share_token', token).maybeSingle()

  if (!order) return NextResponse.json({ error: 'Замовлення не знайдено' }, { status: 404 })

  const { error } = await service.from('order_reviews').upsert({
    order_id: order.id,
    rating,
    // Порожній коментар зберігаємо як порожнечу, а не як рядок із пробілів
    comment: (body?.comment ?? '').trim() || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'order_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

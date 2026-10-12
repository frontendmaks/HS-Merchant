import { NextRequest, NextResponse } from 'next/server'
import { currentActor } from '@/lib/order-events'
import { changeOrderStatus } from '@/lib/order-status-change'

/**
 * Зміна статусу з інтерфейсу.
 *
 * Сама робота — в lib/order-status-change: її ж викликає інтеграція, і правила
 * мають бути одні. Тут лишається тільки питання «хто це».
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Раніше цей маршрут не питав нікого ні про що: будь-хто, знаючи адресу, міг
  // змінити статус будь-якого замовлення. Перевірки стояли лише в інтерфейсі,
  // а він не єдиний спосіб сюди потрапити.
  const actor = await currentActor()
  if (!actor) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const { status, platform, external_id } = (await req.json()) as {
    status: string
    platform: string
    external_id: string
  }

  return changeOrderStatus({ id, status, platform, external_id, actor })
}

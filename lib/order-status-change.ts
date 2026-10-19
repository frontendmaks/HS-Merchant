/**
 * Зміна статусу замовлення — в одному місці для всіх, хто її робить.
 *
 * Робили її двоє: оператор через інтерфейс і Бітрікс через інтеграцію. Другий
 * спершу стукав по HTTP у перший — зайвий мережевий стрибок, який до того ж
 * ламався, щойно маршрут почав вимагати автентифікації.
 *
 * Тепер обидва викликають цю функцію. Правила — оплата перед відправкою,
 * причина перед скасуванням, заборона чіпати те, що вже в дорозі — живуть тут
 * і діють однаково, хто б не звертався.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getMaudauJwt, patchMaudauStatus } from '@/lib/maudau'
import { logOrderEvent } from '@/lib/order-events'
import { rozetkaToken } from '@/lib/rozetka-auth'
import { broadcastOrderChange } from '@/lib/order-broadcast'
import { notifyIntegrations } from '@/lib/integration-webhooks'
import { isHandedOver, requiresPayment } from '@/lib/order-statuses'
import { orderSource } from '@/lib/order-source'

const MAUDAU_STATUS_MAP: Record<string, string> = {
  'Нове': 'new_order',
  'Прийнято': 'accepted',
  'Узгоджено': 'approved',
  'На доставці': 'delivering',
  'Прибуло': 'arrived',
  'Доставлено': 'completed',
  'Скасовано': 'canceled',
}


export interface StatusChange {
  id: string
  status: string
  platform: string
  external_id: string
  actor: { id: string; name: string }
}

export async function changeOrderStatus(
  { id, status, platform, external_id, actor }: StatusChange,
): Promise<NextResponse> {
  const supabase = createServiceClient()

  // A parcel already with the courier is driven by the marketplace from here
  const { data: current } = await supabase
    .from('orders').select('status, ttn, cancel_reason, is_paid').eq('id', id).single()

  // Cancelling is the one move that ends an order, and a cancellation with no
  // reason answers nothing later — not for the marketplace, which asks for one,
  // and not for us, where a sixth of last month's lost revenue sits under
  // "причину не вказано". The reason comes first; this route only records it.
  if (status === 'Скасовано' && !(current?.cancel_reason as string | null)?.trim()) {
    return NextResponse.json(
      {
        success: false,
        error: 'Спочатку оберіть причину скасування — вона й скасує замовлення',
      },
      { status: 400 },
    )
  }
  // Передоплата на картку приходить повз маркетплейс, тож його статуси її не
  // показують. Віддати посилку кур'єру без грошей означає дізнатись про це
  // тоді, коли повертати вже нема як.
  //
  // Правило маркетплейсне: там замовлення йдуть передоплатою. Замовлення з
  // сайту й телефону везуть з оплатою на місці, і вимагати позначки «оплачено»
  // перед доставкою означало б просити оператора збрехати.
  if (orderSource(platform) === 'marketplace' && requiresPayment(status) && !current?.is_paid) {
    return NextResponse.json(
      {
        success: false,
        error: 'Замовлення не оплачене — спершу позначте оплату',
      },
      { status: 409 },
    )
  }

  if (isHandedOver(current?.status as string, current?.ttn as string)) {
    return NextResponse.json(
      { success: false, error: 'Замовлення вже в доставці — статус не змінюється' },
      { status: 409 },
    )
  }

  // Read the previous value first so the journal can show the transition
  const { data: before } = await supabase
    .from('orders').select('status').eq('id', id).single()

  const { error: dbError } = await supabase
    .from('orders')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (dbError) return NextResponse.json({ success: false, error: dbError.message }, { status: 500 })

  if (before?.status !== status) {
    await logOrderEvent(supabase, id, 'status',
      { old: before?.status ?? null, new: status }, actor)
  }

  try {
    if (platform === 'maudau') {
      const apiStatus = MAUDAU_STATUS_MAP[status]
      if (!apiStatus) throw new Error(`Unknown MauDau status: ${status}`)

      // Cancellation must go through the cancel route (needs a reason)
      if (apiStatus === 'canceled') {
        await broadcastOrderChange(id, 'status')
        await notifyIntegrations(id, 'order.status_changed')
  return NextResponse.json({ success: true })
      }

      const numericId = external_id.replace(/^MD-/, '')
      const jwt = await getMaudauJwt()

      // MauDau requires approved before delivering
      if (apiStatus === 'delivering') {
        try { await patchMaudauStatus(numericId, 'approved', undefined, jwt) } catch { /* continue */ }
      }

      await patchMaudauStatus(numericId, apiStatus, undefined, jwt)
    } else if (platform === 'rozetka') {
      const numericId = external_id.replace(/^RZ-/, '')

      const detailRes = await fetch(`${process.env.ROZETKA_BASE}/orders/${numericId}`, {
        headers: { Authorization: `Bearer ${await rozetkaToken()}` },
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const detail: any = await detailRes.json()

      const statusAvailable: { child_id: number; title: string }[] =
        detail?.data?.status_available ?? detail?.content?.status_available ?? []

      const match = statusAvailable.find(s =>
        s.title?.toLowerCase().includes(status.toLowerCase()),
      )

      if (!match) {
        return NextResponse.json(
          { success: false, error: 'Статус недоступний для цього замовлення' },
          { status: 500 },
        )
      }

      const putRes = await fetch(`${process.env.ROZETKA_BASE}/orders/${numericId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await rozetkaToken()}`,
        },
        body: JSON.stringify({ status: match.child_id }),
      })
      if (!putRes.ok) {
        const errBody = await putRes.text().catch(() => '')
        throw new Error(`Rozetka update failed: ${putRes.status} ${errBody.slice(0, 200)}`)
      }
    }
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    )
  }

  await broadcastOrderChange(id, 'status')
  await notifyIntegrations(id, 'order.status_changed')
  return NextResponse.json({ success: true })
}

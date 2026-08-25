import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createServiceClient } from '@/lib/supabase/service'

type Service = ReturnType<typeof createServiceClient>

export type OrderEventType =
  | 'status' | 'ttn' | 'cancel' | 'cancel_reason' | 'sync_status' | 'created' | 'items' | 'marketplace_push'

export const EVENT_META: Record<OrderEventType, { label: string; icon: string }> = {
  created:       { label: 'замовлення надійшло',   icon: '✚' },
  status:        { label: 'змінив статус',          icon: '↻' },
  ttn:           { label: 'вказав ТТН',             icon: '▤' },
  cancel:        { label: 'скасував замовлення',    icon: '✕' },
  cancel_reason: { label: 'вказав причину',         icon: '✎' },
  sync_status:   { label: 'статус змінив маркетплейс', icon: '⇄' },
  items:         { label: 'скоригував склад замовлення', icon: '≡' },
  marketplace_push: { label: 'надіслав зміни на маркетплейс', icon: '⇪' },
}

/** Who is acting, resolved from the session cookie. Null for cron/sync. */
export async function currentActor(): Promise<{ id: string; name: string } | null> {
  try {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
    )
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const service = createServiceClient()
    const { data } = await service
      .from('profiles').select('full_name, email').eq('id', user.id).single()
    return {
      id: user.id,
      name: data?.full_name?.trim() || data?.email || user.email || 'Користувач',
    }
  } catch {
    return null
  }
}

/**
 * Appends to an order's journal. Never throws — losing a log line must not
 * fail the action the operator actually asked for.
 *
 * `actor_name` is stored alongside the id so the journal still reads correctly
 * after someone leaves and their profile is removed.
 */
export async function logOrderEvent(
  service: Service,
  orderId: string,
  type: OrderEventType,
  values: { old?: string | null; new?: string | null; details?: unknown },
  actor: { id: string; name: string } | null,
): Promise<void> {
  try {
    await service.from('order_events').insert({
      order_id: orderId,
      actor_id: actor?.id ?? null,
      actor_name: actor?.name ?? null,
      type,
      old_value: values.old ?? null,
      new_value: values.new ?? null,
      details: values.details ?? null,
    })
  } catch (e) {
    console.error('logOrderEvent failed:', e)
  }
}

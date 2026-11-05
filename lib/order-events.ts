import { currentProfile } from '@/lib/session'
import { createServiceClient } from '@/lib/supabase/service'

type Service = ReturnType<typeof createServiceClient>

export type OrderEventType =
  | 'status' | 'ttn' | 'cancel' | 'cancel_reason' | 'sync_status' | 'created' | 'items' | 'marketplace_push' | 'shipment' | 'operator_comment' | 'payment'

export const EVENT_META: Record<OrderEventType, { label: string; icon: string }> = {
  created:       { label: 'замовлення надійшло',   icon: '✚' },
  status:        { label: 'змінив статус',          icon: '↻' },
  payment:       { label: 'позначив оплату',        icon: '₴' },
  ttn:           { label: 'вказав ТТН',             icon: '▤' },
  cancel:        { label: 'скасував замовлення',    icon: '✕' },
  cancel_reason: { label: 'вказав причину',         icon: '✎' },
  sync_status:   { label: 'статус змінив маркетплейс', icon: '⇄' },
  items:         { label: 'скоригував склад замовлення', icon: '≡' },
  marketplace_push: { label: 'надіслав зміни на маркетплейс', icon: '⇪' },
  shipment:      { label: 'вказав вагу відправлення', icon: '⚖' },
  operator_comment: { label: 'залишив коментар',      icon: '✎' },
}

/** Who is acting, resolved from the session cookie. Null for cron/sync. */
export async function currentActor(): Promise<{ id: string; name: string } | null> {
  const profile = await currentProfile()
  return profile ? { id: profile.id, name: profile.name } : null
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
      /*
       * Порожній номер — це не номер.
       *
       * Дію без людини підписують іменем і порожнім рядком замість
       * номера: «Бітрікс», «Закриття дня», «Мерчант», «Клієнт
       * (Telegram)». Колонка має тип uuid, порожній рядок у неї не
       * лягає, вставка падала — і `catch` нижче ховав це мовчки. За
       * тиждень у журналі жодного такого запису: статус, змінений у
       * CRM, скасування вночі, відправлення на маркетплейс — усе це
       * ставалось, і сліду не лишало. Саме тому на питання «хто це
       * зробив» журнал відповідав порожнечею.
       */
      actor_id: actor?.id || null,
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

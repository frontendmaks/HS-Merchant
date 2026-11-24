/**
 * Замовлення з Prom.ua.
 *
 * Шість замовлень прийшло на Prom за три місяці, і жодне не дійшло до
 * Мерчанта: інтеграції не було зовсім. Одне з них — від 13 листопада,
 * Київ, поштомат, 760 ₴ — пролежало у статусі «нове» п'ять днів, бо
 * про нього ніхто не знав.
 *
 * Далі все як у МауДау й Rozetka: рядок у `orders`, звідти автопілот
 * веде його в Бітрікс, на дошку й у чат складу.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { notifyNewOrders } from '@/lib/order-notifications'
import { changedRows } from '@/lib/sync-hash'
import { promOrders, type PromOrder } from '@/lib/prom-api'
import { broadcastOrderChange } from '@/lib/order-broadcast'
import { notifyIntegrations } from '@/lib/integration-webhooks'

/**
 * Статуси Prom — усі, яківміє видати API.
 *
 * Словник наш, той самий, що в інших майданчиків: нових слів не
 * вводимо, бо на них зав'язані кошики статусів, вибір у списку й
 * Бітрікс.
 */
const STATUS_MAP: Record<string, string> = {
  pending: 'Нове',
  draft: 'Нове',
  received: 'Прийнято',
  paid: 'Оплачено',
  delivered: 'Доставлено',
  canceled: 'Скасовано',
}

export const PROM_STATUS_BACK: Record<string, string> = {
  'Прийнято': 'received',
  'Оплачено': 'paid',
  'Доставлено': 'delivered',
  'Скасовано': 'canceled',
}

const money = (v: unknown): number => {
  /* Prom віддає суму рядком із нерозривними пробілами: «1 589 грн» */
  const n = Number(String(v ?? '').replace(/[^\d.,-]/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

const fullName = (o: PromOrder) =>
  [o.client_last_name, o.client_first_name, o.client_second_name]
    .map(s => (s ?? '').trim()).filter(Boolean).join(' ') || null

/** Куди везти: служба доставки плюс те, що вибрав покупець. */
const buildAddress = (o: PromOrder) =>
  [o.delivery_option?.name, o.delivery_address]
    .map(s => (s ?? '').trim()).filter(Boolean).join(', ') || ''

/* Назви позицій — українською: російська на старих картках Prom буває
   зіпсована, а склад читає саме цей список */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const buildItems = (products: any[]) =>
  (products ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((p: any) =>
      `${p.name_multilang?.uk || p.name || ''}, ${Number(p.quantity ?? 1)} ${p.measure_unit ?? 'шт'} x ${money(p.price)} грн`)
    .join('\n')

export function promOrderToRow(o: PromOrder) {
  const status = STATUS_MAP[o.status] ?? o.status
  const canceled = status === 'Скасовано'

  return {
    external_id: `PR-${o.id}`,
    platform: 'prom',
    order_date: (o.date_created ?? '').slice(0, 10) || null,
    customer_name: fullName(o),
    customer_phone: o.phone ?? null,
    address: buildAddress(o),
    branch: o.delivery_option?.name ?? null,
    items: buildItems(o.products),
    total: money(o.price),
    commission: 0,
    status,
    status_raw: String(o.status),
    /* Причину скасування Prom кладе в окремий об'єкт, і буває, що там
       лише вільний текст без коду */
    cancel_reason: canceled
      ? (o.cancellation?.text?.trim() || o.cancellation?.reason?.trim() || 'Скасовано')
      : null,
    customer_comment: (o.client_notes ?? '').trim() || null,
    raw: o as unknown as Record<string, unknown>,
    updated_at: new Date().toISOString(),
  }
}

type SyncMode = 'quick' | 'full'

export async function syncProm(mode: SyncMode = 'full'): Promise<{ synced: number }> {
  const supabase = createServiceClient()

  /* Швидкий прохід дивиться добу назад, повний — від початку року */
  const since = mode === 'quick'
    ? new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    : `${new Date().getFullYear()}-01-01`

  const orders = await promOrders(since)
  if (!orders.length) return { synced: 0 }

  const rows = orders.map(promOrderToRow)
  const externalIds = rows.map(r => r.external_id)

  const { data: existing, error: readError } = await supabase
    .from('orders')
    .select('id, external_id, status, cancel_reason, customer_comment, sync_hash')
    .in('external_id', externalIds)
    .eq('platform', 'prom')

  /* Невдале читання — це не «жодного з них ми не знаємо». Інакше прохід
     оголосив би всі замовлення новими й затер би причини скасування */
  if (readError) {
    throw new Error(`Не вдалося прочитати наявні замовлення: ${readError.message}`)
  }

  const known = new Set((existing ?? []).map(r => r.external_id as string))
  const fresh = rows.filter(r => !known.has(r.external_id))

  const keep = <T>(get: (r: Record<string, unknown>) => T) => new Map(
    (existing ?? []).map(r => [r.external_id as string, get(r as Record<string, unknown>)]),
  )
  const reasons = keep(r => r.cancel_reason as string | null)
  const comments = keep(r => r.customer_comment as string | null)

  const toUpsert = rows.map(r => ({
    ...r,
    cancel_reason: r.cancel_reason ?? reasons.get(r.external_id) ?? null,
    customer_comment: r.customer_comment ?? comments.get(r.external_id) ?? null,
  }))

  const hashes = new Map(
    (existing ?? []).filter(r => r.sync_hash).map(r => [r.external_id as string, r.sync_hash as string]),
  )
  const toWrite = changedRows(toUpsert, hashes)

  if (toWrite.length) {
    const { error } = await supabase
      .from('orders')
      .upsert(toWrite, { onConflict: 'external_id,platform' })
    if (error) throw error
  }

  if (fresh.length) await notifyNewOrders(supabase, 'prom', fresh as never)
  if (toWrite.length) {
    /* Нове замовлення має з'явитись у кожному відкритому списку одразу,
       а не на наступному опитуванні */
    await broadcastOrderChange('*', 'sync')
    await notifyIntegrations('*', 'order.created')
  }

  return { synced: rows.length }
}

import type { createServiceClient } from '@/lib/supabase/service'

type Service = ReturnType<typeof createServiceClient>

export const PLATFORM_LABELS: Record<string, string> = {
  maudau: 'MauDau',
  rozetka: 'Rozetka',
}

interface NewOrder {
  external_id: string
  customer_name?: string | null
  total?: number | null
}

const money = (n: number | null | undefined) =>
  n == null ? null : `₴${Number(n).toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * Everyone who works orders.
 *
 * Named rather than excluded by role, so a role added later has to be thought
 * about before it starts receiving a notice for every order. Viewers only
 * observe; an analyst reads the analytics screen and cannot open an order at
 * all — a banner per order would be noise neither of them can act on.
 */
const ORDER_ROLES = ['super_admin', 'admin', 'manager', 'operator']

async function recipients(supabase: Service): Promise<string[]> {
  const { data } = await supabase
    .from('profiles')
    .select('id')
    .eq('is_active', true)
    .in('role', ORDER_ROLES)
  return (data ?? []).map(r => r.id)
}

/**
 * Announces orders that were not in the database before this sync.
 * Never throws — a notification problem must not fail the sync itself.
 */
export async function notifyNewOrders(
  supabase: Service,
  platform: string,
  orders: NewOrder[],
): Promise<number> {
  if (!orders.length) return 0

  try {
    const users = await recipients(supabase)
    if (!users.length) return 0

    const label = PLATFORM_LABELS[platform] ?? platform
    const rows: Record<string, unknown>[] = []

    // One notice per order, always. A summary saying "51 new orders" names
    // none of them, so nobody can tell which are already handled — and the
    // wall of banners it was meant to prevent came from announcing the same
    // orders over and over, which is fixed where it was caused.
    for (const order of orders) {
      const parts = [order.external_id, order.customer_name?.trim(), money(order.total)]
        .filter(Boolean)
      for (const user_id of users) {
        rows.push({
          user_id,
          type: 'order_new',
          title: `Нове замовлення · ${label}`,
          body: parts.join(' · '),
          link: '/orders',
        })
      }
    }

    const { error } = await supabase.from('notifications').insert(rows)
    if (error) {
      console.error('notifyNewOrders insert failed:', error.message)
      return 0
    }
    return rows.length
  } catch (e) {
    console.error('notifyNewOrders failed:', e)
    return 0
  }
}

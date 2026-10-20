/**
 * Самостійне опрацювання маркетплейсних замовлень.
 *
 * Замовлення, яке прийшло з майданчика, спершу треба прийняти — інакше воно
 * висить, і покупець не знає, чи ми його бачили. Потім воно має опинитись у
 * Бітріксі, бо збирає його той самий склад, що й усе решта.
 *
 * Прийняти замовлення на майданчику — це обіцянка покупцеві, тож уся ця
 * робота вимкнена, поки її не ввімкнули свідомо.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { changeOrderStatus } from '@/lib/order-status-change'
import { pushMarketplaceOrder } from '@/lib/marketplace-bitrix'
import { currentActor } from '@/lib/order-events'
import { broadcastOrderChange } from '@/lib/order-broadcast'
import { isNew } from '@/lib/order-statuses'

type Service = ReturnType<typeof createServiceClient>

/** Як називається «прийнято» на кожному майданчику */
const ACCEPTED: Record<string, string> = {
  maudau: 'Прийнято',
  rozetka: 'Опрацьовується',
}

export interface MarketplaceResult {
  looked: number
  accepted: number
  pushed: number
  problems: { order: string; error: string }[]
  error?: string
}

export async function processMarketplaceOrders(
  service: Service,
  { limit = 20 }: { limit?: number } = {},
): Promise<MarketplaceResult> {
  const result: MarketplaceResult = { looked: 0, accepted: 0, pushed: 0, problems: [] }

  try {
    // Система діє від свого імені: у журналі замовлення має бути видно, що
    // статус змінила не людина
    const actor = await currentActor() ?? { id: '', name: 'Мерчант' }

    const { data } = await service
      .from('orders')
      .select('id, external_id, platform, status, bitrix_deal_id')
      .in('platform', ['maudau', 'rozetka'])
      .is('bitrix_deal_id', null)
      .gte('order_date', new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10))
      .order('order_date', { ascending: true })
      .limit(limit)

    const orders = data ?? []
    result.looked = orders.length

    for (const order of orders) {
      const platform = order.platform as string

      // Нове — приймаємо; уже прийняте просто доносимо в Бітрікс
      if (isNew(order.status as string)) {
        const target = ACCEPTED[platform]
        const moved = target
          ? await changeOrderStatus({
              id: order.id as string,
              status: target,
              platform,
              external_id: (order.external_id as string) ?? '',
              actor,
            })
          : null

        if (moved && !moved.ok) {
          const body = await moved.json().catch(() => ({})) as { error?: string }
          result.problems.push({
            order: order.external_id as string,
            error: body.error ?? 'не вдалося прийняти',
          })
          continue
        }
        if (moved?.ok) result.accepted++
      }

      const pushed = await pushMarketplaceOrder(service, order.id as string)
      if ('error' in pushed) {
        result.problems.push({ order: order.external_id as string, error: pushed.error })
      } else {
        result.pushed++
        await broadcastOrderChange(order.id as string, 'sync')
      }
    }
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e)
  }

  return result
}

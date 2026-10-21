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
import { isNew, PAYMENT_STAGE_STATUSES } from '@/lib/order-statuses'
import { stageId, stageName, CLOSED_STAGES } from '@/lib/bitrix-stages'
import { onStatusChanged } from '@/lib/bitrix-chat'
import { bitrix } from '@/lib/bitrix'

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
  /** Скільки оплачених узгоджених замовлень пішло на комплектацію */
  picking: number
  problems: { order: string; error: string }[]
  error?: string
}

export async function processMarketplaceOrders(
  service: Service,
  { limit = 20 }: { limit?: number } = {},
): Promise<MarketplaceResult> {
  const result: MarketplaceResult = {
    looked: 0, accepted: 0, pushed: 0, picking: 0, problems: [],
  }

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
    await startPicking(service, result)
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e)
  }

  return result
}

/**
 * Оплачене й узгоджене — на комплектацію.
 *
 * Маркетплейс свого «комплектується» не має: для нього замовлення узгоджене
 * й на тому все. Збирає ж його наш склад, і дізнається він про це з
 * Бітрікса. Поки стадію не переставили, оплачене замовлення просто лежало.
 *
 * Оплата тут вирішальна: маркетплейсні замовлення йдуть передоплатою повз
 * майданчик, і зібрати неоплачене означає відправити посилку за свій
 * рахунок.
 */
const PICKING = 'Комплектується'

async function startPicking(service: Service, result: MarketplaceResult): Promise<void> {
  const { data } = await service
    .from('orders')
    .select('id, external_id, platform, status, bitrix_deal_id')
    .in('platform', ['maudau', 'rozetka'])
    .not('bitrix_deal_id', 'is', null)
    .eq('is_paid', true)
    .in('status', PAYMENT_STAGE_STATUSES)
    .gte('order_date', new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10))
    .limit(30)

  const orders = data ?? []
  if (!orders.length) return

  const target = stageId(PICKING)
  if (!target) return

  for (const order of orders) {
    const dealId = Number(order.bitrix_deal_id)

    // Питаємо стадію, щоб не переставляти її щопроходу: Бітрікс пише в
    // стрічку угоди кожну зміну, і склад читав би ту саму новину двічі
    const deal = await bitrix<{ STAGE_ID?: string }>('crm.deal.get', { id: dealId })
    if (deal?.STAGE_ID === target) continue
    if (deal?.STAGE_ID && CLOSED_STAGES.includes(stageName(deal.STAGE_ID) ?? '')) continue

    await bitrix('crm.deal.update', { id: dealId, fields: { STAGE_ID: target } })

    // Бланк у чат складу — те саме, що відбувається для замовлень із сайту
    await onStatusChanged(service, order.id as string, PICKING)
    await broadcastOrderChange(order.id as string, 'sync')
    result.picking++
  }
}

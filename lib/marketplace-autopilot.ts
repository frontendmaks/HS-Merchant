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
import { stageId, stageName, CLOSED_STAGES } from '@/lib/bitrix-stages'
import { sendToChat } from '@/lib/bitrix-chat'
import { getSetting } from '@/lib/settings'
import { platformLabel } from '@/lib/order-source'
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
      /*
       * Два тижні, а не три дні.
       *
       * Вікно в три дні мовчки кидало все, що не встигли опрацювати:
       * опрацювання вмикали вже після того, як замовлення приїхали, і
       * сім жовтневих так і лишились без угоди — склад їх не бачив.
       * Беремо старші першими, тож черга розбирається з хвоста.
       */
      .gte('order_date', new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10))
      .neq('status', 'Скасовано')
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
interface MarketplaceOrder {
  id: string
  platform: string
  external_id: string | null
  share_token: string | null
  chat_sent_at: string | null
}

/**
 * Повідомлення про маркетплейсне замовлення — у чат Гуртівні.
 *
 * Накладну під нього набивають саме там, і до того, як її звірять із
 * клієнтом, замовлення нікуди не їде. Тому в чат іде не голий бланк, як
 * для сайтових, а те, що з ним треба зробити.
 *
 * Надсилаємо один раз: позначка на замовленні та сама, що й для бланка
 * складу, і повторний прохід через неї не пише нічого вдруге.
 */
async function tellWarehouse(service: Service, order: MarketplaceOrder): Promise<void> {
  if (order.chat_sent_at || !order.share_token) return

  try {
    const warehouse = await getSetting(service, 'marketplace_chat_warehouse')
    const { data: chat } = await service
      .from('warehouse_chats').select('dialog_id').eq('warehouse', warehouse).maybeSingle()

    if (!chat) {
      await service.from('orders')
        .update({ chat_error: `Для складу «${warehouse}» не вказано чат` })
        .eq('id', order.id)
      return
    }

    const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://hs-merchant.vercel.app'
    const text = `Замовлення з ${platformLabel(order.platform)}, `
      + 'потрібно набити накладну для узгодження з клієнтом - '
      + `${base}/zamovlennya/${order.share_token}`

    await sendToChat(chat.dialog_id as string, text)

    await service.from('orders')
      .update({ chat_sent_at: new Date().toISOString(), chat_error: null })
      .eq('id', order.id)
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    await service.from('orders').update({ chat_error: error }).eq('id', order.id)
  }
}

const PICKING = 'Комплектується'

async function startPicking(service: Service, result: MarketplaceResult): Promise<void> {
  const { data } = await service
    .from('orders')
    .select('id, external_id, platform, status, bitrix_deal_id, share_token, chat_sent_at')
    .in('platform', ['maudau', 'rozetka'])
    .not('bitrix_deal_id', 'is', null)
    .neq('status', 'Скасовано')
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

    /*
     * Чат дізнається інше, ніж про замовлення з сайту.
     *
     * Сайтове приходить на склад готовим — комірникові потрібне саме
     * посилання й більше нічого. Маркетплейсне ж спершу треба набити
     * накладною і звірити з клієнтом, і повідомлення має сказати саме
     * це: інакше його прочитають як чергове замовлення на збірку.
     */
    await tellWarehouse(service, order as MarketplaceOrder)
    await broadcastOrderChange(order.id as string, 'sync')
    result.picking++
  }
}

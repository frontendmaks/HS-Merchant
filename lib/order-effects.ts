import { createServiceClient } from '@/lib/supabase/service'
import { broadcastOrderChange } from '@/lib/order-broadcast'
import { notifyIntegrations } from '@/lib/integration-webhooks'
import { onStatusChanged } from '@/lib/bitrix-chat'

export async function drainOrderEffects(limit = 5): Promise<void> {
  const supabase = createServiceClient()
  const token = crypto.randomUUID()
  const { data, error } = await supabase.rpc('merchant_claim_effects', { p_limit: limit, p_token: token })
  if (error) throw error
  for (const job of (data ?? []) as { id: string; order_id: string; status: string }[]) {
    let failure: string | null = null
    try { await perform(job.order_id, job.status, job.id); await broadcastOrderChange(job.order_id, 'status') }
    catch (e) { failure = e instanceof Error ? e.message : String(e); console.error('order effect', job.id, failure) }
    const { error: finishError } = await supabase.rpc('merchant_finish_effect', {
      p_id: job.id, p_token: token, p_error: failure,
    })
    if (finishError) console.error('order effect completion', finishError.message)
  }
}

async function perform(id: string, status: string, eventId: string): Promise<void> {
  const supabase = createServiceClient()
  await broadcastOrderChange(id, 'status')
  await notifyIntegrations(id, 'order.status_changed', supabase, eventId)
  // Never send an old picking sheet after a newer cancellation.
  const { data: current, error } = await supabase.from('orders').select('status').eq('id', id).single()
  if (error) throw error
  if (current?.status !== status) return
  const result = await onStatusChanged(supabase, id, status)
  if (result.error) throw new Error(result.error)
  /*
   * Скасування клієнт має почути від нас, а не здогадатись із того, що
   * ніхто не приїхав. Причину не переказуємо: вона наша, внутрішня, і
   * «гість не відповідає» в листі покупцеві звучить як звинувачення.
   */
  if (status === 'Скасовано') {
    try {
      const { notifyOnce, orderCanceledText, ORDER_CANCELED } =
        await import('@/lib/customer-notify')
      await notifyOnce(supabase, id, ORDER_CANCELED, orderCanceledText)
    } catch (e) {
      console.error('notify canceled failed:', e instanceof Error ? e.message : e)
    }

    /*
     * Ящик скасованого лишається закритим до кінця дня.
     *
     * Доти ми число звільняли — міркування було просте: ящика не буде,
     * хай працює далі. Але воно вже прозвучало: комірник написав
     * «десятий» на наліпці, кур'єр має його в маршруті, в чаті про нього
     * домовлялись. Другий «десятий» того самого дня плутає рівно там, де
     * плутати найдорожче — на складі з ящиками в руках.
     *
     * Замість звільнення в аркуші з'являється «скасовано»: число
     * закрите, і видно, чому воно порожнє.
     */
    try {
      const { data: o } = await supabase.from('orders')
        .select('manual_number, delivery_date').eq('id', id).single()

      if (o?.manual_number != null && o.delivery_date) {
        const { blockCanceledNumber } = await import('@/lib/manual-register')
        await blockCanceledNumber(supabase, {
          number: Number(o.manual_number), date: o.delivery_date as string, orderId: id,
        })
      }
    } catch (e) {
      console.error('block canceled number failed:', e instanceof Error ? e.message : e)
    }

    /*
     * Картка на дошці теж має піти з роботи.
     *
     * Скасоване замовлення, що лишилось серед робочих карток, — це ящик,
     * який хтось таки збере. Складу воно коштує дорожче, ніж нам зайвий
     * виклик до Trello.
     */
    try {
      const { cardCanceled } = await import('@/lib/trello-cards')
      await cardCanceled(supabase, id)
    } catch (e) {
      console.error('trello cancel failed:', e instanceof Error ? e.message : e)
    }
  }


}

import { acquireLease } from '@/lib/job-lease'
import { createServiceClient } from '@/lib/supabase/service'
import { syncSiteOrders } from '@/lib/bitrix-sync'
import { autoProcessSiteOrders } from '@/lib/site-autopilot'
import { getSetting } from '@/lib/settings'
import { logCronRun } from '@/lib/cron-log'

export async function drainBitrixEvents(limit = 3): Promise<void> {
  const release = await acquireLease('bitrix-event-worker', 240)
  if (!release) return
  try { await drainUnlocked(limit) } finally { await release() }
}

async function drainUnlocked(limit: number): Promise<void> {
  const service = createServiceClient()
  const token = crypto.randomUUID()
  const { data, error } = await service.rpc('merchant_claim_bitrix', { p_token: token, p_limit: limit })
  if (error) throw error
  for (const event of (data ?? []) as { deal_id: number; requested_at: string }[]) {
    const started = Date.now()
    let failure: string | null = null
    try {
      const sync = await syncSiteOrders(service, { dealIds: [String(event.deal_id)], maxPages: 1 })
      if (sync.error || sync.notes?.length) throw new Error(sync.error || sync.notes?.join('; '))
      if ((sync.created || sync.updated) && await getSetting(service, 'auto_process_site_orders')) {
        const { data: order, error } = await service.from('orders').select('id').eq('bitrix_deal_id', event.deal_id).maybeSingle()
        if (error) throw error
        if (order) await autoProcessSiteOrders(service, { orderIds: [order.id], limit: 1 })
      }
    } catch (e) { failure = e instanceof Error ? e.message : String(e) }
    await service.rpc('merchant_finish_bitrix', {
      p_deal_id: event.deal_id, p_token: token, p_requested_at: event.requested_at, p_error: failure,
    })
    await logCronRun(service, 'bitrix-event', started, { deal: event.deal_id }, failure ?? undefined)
  }
}

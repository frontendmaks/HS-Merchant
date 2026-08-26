/**
 * Telling every open panel that an order changed.
 *
 * Broadcast rather than postgres_changes: the tables are closed by RLS with no
 * policies, deliberately, so a browser holding the anon key would receive
 * nothing from a table subscription. A broadcast carries no row data — only
 * that something moved — and each client refetches through the server it is
 * already trusted by.
 *
 * Never throws. A missed notice costs a few seconds until the next poll; a
 * throw here would undo the change it was announcing.
 */

export const ORDERS_TOPIC = 'orders-changes'

export type OrderChangeKind = 'ttn' | 'status' | 'items' | 'cancel' | 'sync'

export async function broadcastOrderChange(
  orderId: string,
  kind: OrderChangeKind,
): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return

  try {
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key },
      body: JSON.stringify({
        messages: [{
          topic: ORDERS_TOPIC,
          event: 'changed',
          payload: { orderId, kind, at: new Date().toISOString() },
        }],
      }),
    })
  } catch {
    // The poll behind this will pick it up
  }
}

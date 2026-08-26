/**
 * Notifications for the working schedule.
 *
 * Mirrors lib/order-notifications.ts: never throws, because a notification
 * failing must not undo the thing it was announcing.
 */

import type { createServiceClient } from '@/lib/supabase/service'

type Service = ReturnType<typeof createServiceClient>

const LINK = '/operators/schedule'

async function idsWithRole(supabase: Service, roles: string[]): Promise<string[]> {
  const { data } = await supabase
    .from('profiles').select('id').eq('is_active', true).in('role', roles)
  return (data ?? []).map(r => r.id as string)
}

export const approvers = (s: Service) => idsWithRole(s, ['super_admin', 'admin', 'manager'])
export const operators = (s: Service) => idsWithRole(s, ['operator'])

export async function notify(
  supabase: Service,
  userIds: string[],
  n: { type: string; title: string; body: string; actorId?: string | null; link?: string },
): Promise<void> {
  const unique = [...new Set(userIds)].filter(Boolean)
  if (!unique.length) return
  try {
    await supabase.from('notifications').insert(unique.map(user_id => ({
      user_id,
      actor_id: n.actorId ?? null,
      type: n.type,
      title: n.title,
      body: n.body,
      link: n.link ?? LINK,
    })))
  } catch {
    // A missed banner is not worth failing the action for
  }
}

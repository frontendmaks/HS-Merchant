/**
 * Notifications for the working schedule.
 *
 * Two different questions live here and must not be conflated:
 *
 *   who may approve   — administrators and managers, matching lib/schedule.ts
 *   who gets told     — operators and managers only
 *
 * An administrator can act on the schedule but is deliberately not notified
 * about it, so the tab stays quiet for everyone it is not actually about.
 *
 * Mirrors lib/order-notifications.ts: never throws, because a notification
 * failing must not undo the thing it was announcing.
 */

import type { createServiceClient } from '@/lib/supabase/service'

type Service = ReturnType<typeof createServiceClient>

const LINK = '/operators/schedule'

/** Notification types this feature produces, so they can be filtered out for
 *  anyone who should not see them. */
export const SCHEDULE_NOTIFICATION_TYPES = [
  'schedule_submitted', 'schedule_approved', 'schedule_amend',
  'schedule_sent_back', 'schedule_reopened', 'schedule_due', 'schedule_overdue',
  'swap_request', 'swap_approved', 'swap_declined',
]

async function idsWithRole(supabase: Service, roles: string[]): Promise<string[]> {
  const { data } = await supabase
    .from('profiles').select('id').eq('is_active', true).in('role', roles)
  return (data ?? []).map(r => r.id as string)
}

/** Everyone the schedule is genuinely about. Nobody else hears a thing. */
export const audience = (s: Service) => idsWithRole(s, ['operator', 'manager'])

/** Management's half of the notifications — managers only, by instruction,
 *  even though an administrator may also approve. */
export const managers = (s: Service) => idsWithRole(s, ['manager'])

export const operators = (s: Service) => idsWithRole(s, ['operator'])

/** Who may settle the manager half of a swap. Not a notification question —
 *  this decides whether a swap still needs a second signature at all. */
export const approvers = (s: Service) => idsWithRole(s, ['admin', 'manager'])

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

/**
 * Announcements — what changed in how we work.
 *
 * Two different questions live here and are easy to confuse. *Writing* is for
 * management. *Being addressed* is a choice made per piece: an announcement
 * about order handling concerns operators, one about pricing does not. The
 * three managing roles read everything either way, because someone has to be
 * able to answer "what did we tell the team".
 */

import type { UserRole } from '@/lib/roles'

export const NEWS_AUTHORS = ['super_admin', 'admin', 'manager'] as const

export const canWriteNews = (role: string | null | undefined) =>
  !!role && (NEWS_AUTHORS as readonly string[]).includes(role)

/** The same three see every piece, addressed to them or not. */
export const seesAllNews = canWriteNews

/** Roles an announcement can be addressed to. */
export const AUDIENCE_ROLES: Exclude<UserRole, null>[] =
  ['super_admin', 'admin', 'manager', 'operator', 'viewer']

export const isForMe = (
  audience: string[] | null | undefined,
  role: string | null | undefined,
): boolean => seesAllNews(role) || (audience ?? []).includes(role ?? '')

export type NewsStatus = 'draft' | 'published'

export const NEWS_STATUS_META: Record<NewsStatus, { label: string; badge: string }> = {
  draft:     { label: 'Чернетка',    badge: 'bg-zinc-800 text-zinc-400' },
  published: { label: 'Опубліковано', badge: 'bg-emerald-950/60 text-emerald-400' },
}

/** A headline is what people see in the list; empty helps nobody. */
export const MIN_NEWS_TITLE = 3

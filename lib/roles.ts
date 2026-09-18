// Pure role logic — no server imports, safe for client components.

export type UserRole =
  | 'super_admin' | 'admin' | 'manager' | 'operator' | 'analyst' | 'viewer' | null

export const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Супер адміністратор',
  admin:       'Адміністратор',
  manager:     'Керівник',
  operator:    'Оператор',
  analyst:     'Аналітик',
  viewer:      'Глядач',
}

/** Higher rank = more privileges. Used for "can act on this user" checks. */
const RANK: Record<string, number> = {
  super_admin: 4,
  admin: 3,
  manager: 2,
  operator: 1,
  // Reads one screen and changes nothing, so it ranks with the other
  // read-only role rather than above anyone
  analyst: 1,
  viewer: 0,
}

export const roleRank = (role: string | null | undefined): number =>
  RANK[role ?? ''] ?? -1

/** Roles each role is allowed to hand out, highest first.
 *  Керівник may not grant anything above Оператор. */
const ASSIGNABLE: Record<string, UserRole[]> = {
  super_admin: ['super_admin', 'admin', 'manager', 'operator', 'analyst', 'viewer'],
  admin:       ['manager', 'operator', 'analyst', 'viewer'],
  manager:     ['operator', 'viewer'],
}

export const assignableRoles = (callerRole: string | null | undefined): UserRole[] =>
  ASSIGNABLE[callerRole ?? ''] ?? []

export const canAssignRole = (callerRole: string | null | undefined, target: string): boolean =>
  assignableRoles(callerRole).includes(target as UserRole)

/** Roles allowed into the users screen at all. */
/**
 * Sees the trade — what sold, where and to whom — and nothing about how the
 * team works. The operator table and the cancellation reasons are about people
 * here, not about the market, so they stay out of this role's view; the page
 * does not render them and the server does not send them.
 */
export const isAnalyst = (role: string | null | undefined) => role === 'analyst'

export const canManageUsers = (role: string | null | undefined): boolean =>
  assignableRoles(role).length > 0

/** Can the caller edit/deactivate/delete a user who currently holds targetRole?
 *  Requires strictly higher rank, so peers can never act on each other. */
export const canManageUser = (
  callerRole: string | null | undefined,
  targetRole: string | null | undefined
): boolean => canManageUsers(callerRole) && roleRank(callerRole) > roleRank(targetRole)

// --- Page access ---------------------------------------------------------

/** Roles that may open each section. Keep in sync with components/Sidebar.tsx. */
export const PAGE_ROLES = {
  dashboard: ['super_admin', 'admin', 'viewer'],
  products:  ['super_admin', 'admin', 'viewer'],
  feeds:     ['super_admin', 'admin', 'viewer'],
  syncs:     ['super_admin', 'admin', 'manager'],
  analytics: ['super_admin', 'admin', 'manager', 'analyst'],
  orders:    ['super_admin', 'admin', 'manager', 'operator', 'viewer'],
  requests:  ['super_admin', 'admin', 'manager', 'operator', 'viewer'],
  /** Everyone has a newsfeed; which pieces land in it is decided per piece
   *  by its audience — see lib/news.ts */
  news:      ['super_admin', 'admin', 'manager', 'operator', 'viewer'],
  users:     ['super_admin', 'admin', 'manager'],
  /** Operators plan their own week here; management approves it */
  schedule:  ['super_admin', 'admin', 'manager', 'operator'],
  /** The change journal exposes who did what — management only */
  orderJournal: ['super_admin', 'admin', 'manager'],
  /** Anyone may ask for a product to be taken out of sale — an operator on the
   *  phone hears "it is off the shelf" before anyone else does. Who decides is
   *  a separate question, and a narrower one: see canDecideRemoval. */
  productRemovals: ['super_admin', 'admin', 'manager', 'operator', 'viewer'],
} as const

export const canAccess = (
  page: keyof typeof PAGE_ROLES,
  role: string | null | undefined
): boolean => (PAGE_ROLES[page] as readonly string[]).includes(role ?? '')

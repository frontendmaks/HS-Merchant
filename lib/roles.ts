// Pure role logic — no server imports, safe for client components.

export type UserRole = 'super_admin' | 'admin' | 'manager' | 'operator' | 'viewer' | null

export const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Супер адміністратор',
  admin:       'Адміністратор',
  manager:     'Керівник',
  operator:    'Оператор',
  viewer:      'Глядач',
}

/** Higher rank = more privileges. Used for "can act on this user" checks. */
const RANK: Record<string, number> = {
  super_admin: 4,
  admin: 3,
  manager: 2,
  operator: 1,
  viewer: 0,
}

export const roleRank = (role: string | null | undefined): number =>
  RANK[role ?? ''] ?? -1

/** Roles each role is allowed to hand out, highest first.
 *  Керівник may not grant anything above Оператор. */
const ASSIGNABLE: Record<string, UserRole[]> = {
  super_admin: ['super_admin', 'admin', 'manager', 'operator', 'viewer'],
  admin:       ['manager', 'operator', 'viewer'],
  manager:     ['operator', 'viewer'],
}

export const assignableRoles = (callerRole: string | null | undefined): UserRole[] =>
  ASSIGNABLE[callerRole ?? ''] ?? []

export const canAssignRole = (callerRole: string | null | undefined, target: string): boolean =>
  assignableRoles(callerRole).includes(target as UserRole)

/** Roles allowed into the users screen at all. */
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
  analytics: ['super_admin', 'admin', 'manager'],
  orders:    ['super_admin', 'admin', 'manager', 'operator', 'viewer'],
  requests:  ['super_admin', 'admin', 'manager', 'operator', 'viewer'],
  users:     ['super_admin', 'admin', 'manager'],
} as const

export const canAccess = (
  page: keyof typeof PAGE_ROLES,
  role: string | null | undefined
): boolean => (PAGE_ROLES[page] as readonly string[]).includes(role ?? '')

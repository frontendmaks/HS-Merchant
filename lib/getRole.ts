import { currentProfile } from '@/lib/session'
import type { UserRole } from '@/lib/roles'

export type { UserRole }
export * from '@/lib/roles'

export async function getCurrentRole(): Promise<UserRole> {
  return (await currentProfile())?.role ?? null
}

export const ADMIN_ROLES: UserRole[] = ['super_admin', 'admin']
export const isAdmin = (role: UserRole) => ADMIN_ROLES.includes(role)
export const isViewer = (role: UserRole) => role === 'viewer'
export const isOperator = (role: UserRole) => role === 'operator'
export const isManager = (role: UserRole) => role === 'manager'

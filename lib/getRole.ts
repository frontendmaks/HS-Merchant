import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import type { UserRole } from '@/lib/roles'

export type { UserRole }
export * from '@/lib/roles'

export async function getCurrentRole(): Promise<UserRole> {
  try {
    const supabase = await createClient()
    // Read from the signed token rather than asking the Auth service — every
    // page render went through here, and the round trip bought nothing the
    // signature does not already prove
    const { data: claims } = await supabase.auth.getClaims()
    const userId = claims?.claims?.sub as string | undefined
    if (!userId) return null
    const service = createServiceClient()
    const { data } = await service.from('profiles').select('role').eq('id', userId).single()
    return (data?.role as UserRole) ?? 'viewer'
  } catch {
    return null
  }
}

export const ADMIN_ROLES: UserRole[] = ['super_admin', 'admin']
export const isAdmin = (role: UserRole) => ADMIN_ROLES.includes(role)
export const isViewer = (role: UserRole) => role === 'viewer'
export const isOperator = (role: UserRole) => role === 'operator'
export const isManager = (role: UserRole) => role === 'manager'

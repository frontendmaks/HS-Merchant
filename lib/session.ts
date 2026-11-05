import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { deadline } from '@/lib/http'
import type { UserRole } from '@/lib/roles'

/** Request-scoped only: never share identities or roles across users. */
export const currentProfile = cache(async () => {
  const auth = await createClient()
  const { data, error } = await deadline(auth.auth.getClaims(), 5000)
  const id = data?.claims?.sub
  if (error || typeof id !== 'string') return null
  const { data: profile, error: profileError } = await createServiceClient()
    .from('profiles').select('role, full_name, email').eq('id', id).single()
  if (profileError || !profile) throw new Error('Не вдалося перевірити доступ. Спробуйте ще раз')
  return { id, role: profile.role as UserRole,
    name: profile.full_name?.trim() || profile.email || 'Користувач' }
})

export async function currentUserId(): Promise<string | null> {
  const auth = await createClient()
  const { data, error } = await deadline(auth.auth.getClaims(), 5000)
  return error ? null : (data?.claims?.sub as string | undefined) ?? null
}

import { cookies } from 'next/headers'
import { accessTokenFromCookies, transientAuthError } from '@/lib/auth-session-cookie'
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { deadline } from '@/lib/http'
import type { UserRole } from '@/lib/roles'

export async function verifiedClaims() {
  const token = accessTokenFromCookies((await cookies()).getAll(), process.env.NEXT_PUBLIC_SUPABASE_URL!)
  if (!token) return null
  const auth = await createClient()
  // Explicit JWT skips getSession() and its eager network refresh on ordinary reads.
  const { data, error } = await deadline(auth.auth.getClaims(token), 16000)
  if (error && transientAuthError(error)) throw new Error('Авторизація тимчасово недоступна. Спробуйте ще раз')
  return error ? null : data?.claims ?? null
}

/** Request-scoped only: never share identities or roles across users. */
export const currentProfile = cache(async () => {
  const claims = await verifiedClaims()
  const id = claims?.sub
  if (typeof id !== 'string') return null
  const { data: profile, error: profileError } = await createServiceClient()
    .from('profiles').select('role, full_name, email').eq('id', id).single()
  if (profileError || !profile) throw new Error('Не вдалося перевірити доступ. Спробуйте ще раз')
  return { id, role: profile.role as UserRole,
    name: profile.full_name?.trim() || profile.email || 'Користувач' }
})

export async function currentUserId(): Promise<string | null> {
  return (await verifiedClaims())?.sub ?? null
}

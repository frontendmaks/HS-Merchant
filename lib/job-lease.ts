import { createServiceClient } from '@/lib/supabase/service'

/** A database lease works across functions, cron runs and webhook processes. */
export async function acquireLease(key: string, seconds = 300) {
  const token = crypto.randomUUID()
  const db = createServiceClient()
  const { data, error } = await db.rpc('merchant_acquire_lease', {
    p_key: key, p_token: token, p_seconds: seconds,
  })
  if (error) throw error
  if (!data) return null
  return async () => {
    const { error } = await db.rpc('merchant_release_lease', { p_key: key, p_token: token })
    if (error) console.error('lease release failed', key, error.message)
  }
}

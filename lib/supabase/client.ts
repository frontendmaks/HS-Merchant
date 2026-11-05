import { browserAuthFetch } from '@/lib/auth-fetch'
import { createBrowserClient } from '@supabase/ssr'

/**
 * One client per tab.
 *
 * Every client carries its own auth-token refresh timer and its own realtime
 * socket, so building one per component multiplies both by however many
 * components happen to be on screen — a list of forty orders was opening forty
 * of each, and the token refreshes alone accounted for most of the auth
 * traffic the project was carrying.
 */
function buildClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { fetch: browserAuthFetch(process.env.NEXT_PUBLIC_SUPABASE_URL!) } },
  )
}
let browserClient: ReturnType<typeof buildClient> | undefined
export function createClient() { return browserClient ??= buildClient() }

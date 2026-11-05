import { createClient } from '@supabase/supabase-js'
import { timedFetch } from '@/lib/http'

function buildClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: timedFetch(12000) } },
  )
}

let service: ReturnType<typeof buildClient> | undefined
export function createServiceClient() { return service ??= buildClient() }

/** Browser Auth uses the app's origin; the server alone contacts the fixed Supabase upstream. */
export function browserAuthFetch(supabaseUrl: string): typeof fetch {
  const upstream = new URL(supabaseUrl)
  return async (input, init) => {
    const raw = input instanceof Request ? input.url : String(input)
    const url = new URL(raw)
    if (typeof window !== 'undefined' && url.origin === upstream.origin && url.pathname.startsWith('/auth/v1/')) {
      const target = `/api/auth/bridge/${url.pathname.slice('/auth/v1/'.length)}${url.search}`
      return fetch(target, { ...init, signal: init?.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) })
    }
    return fetch(input, init)
  }
}

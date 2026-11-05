/** Decode storage only; identity is NEVER trusted until getClaims verifies it. */
export function accessTokenFromCookies(cookies: { name: string; value: string }[], url: string): string | null {
  try {
    const key = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`
    const exact = cookies.find(c => c.name === key)
    const chunks = cookies.filter(c => c.name.startsWith(key + '.') && /^\d+$/.test(c.name.slice(key.length + 1)))
      .sort((a, b) => Number(a.name.slice(key.length + 1)) - Number(b.name.slice(key.length + 1)))
    if (!exact && chunks.some((c, i) => c.name !== `${key}.${i}`)) return null
    let raw = exact?.value ?? chunks.map(c => c.value).join('')
    if (!raw) return null
    if (raw.startsWith('base64-')) raw = Buffer.from(raw.slice(7), 'base64url').toString('utf8')
    const session = JSON.parse(raw)
    return typeof session?.access_token === 'string' && session.access_token ? session.access_token : null
  } catch { return null }
}

/** Used solely to choose refresh vs verification, never for authorization. */
export function tokenNeedsRefresh(token: string): boolean {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
    return typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now()
  } catch { return true }
}

export function transientAuthError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { name?: string; status?: number; message?: string }
  return !e.status || e.status >= 500 || e.status === 429
    || e.name === 'AuthRetryableFetchError' || /timeout|timed out|fetch|network|temporar/i.test(e.message ?? '')
}

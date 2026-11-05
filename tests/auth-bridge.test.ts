import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST, GET } from '@/app/api/auth/bridge/[...path]/route'
import { browserAuthFetch } from '@/lib/auth-fetch'
import { accessTokenFromCookies, tokenNeedsRefresh } from '@/lib/auth-session-cookie'
const context = (path: string[]) => ({ params: Promise.resolve({ path }) })
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'public-key')
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
it('forwards password login only to the fixed Auth endpoint with public credentials', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ access_token: 'example-token' }))
  vi.stubGlobal('fetch', fetcher)
  const result = await POST(new NextRequest('https://merchant.test/api/auth/bridge/token?grant_type=password', {
    method: 'POST', headers: { origin: 'https://merchant.test' }, body: JSON.stringify({ email: 'test@example.test', password: 'dummy' }),
  }), context(['token']))
  expect(result.status).toBe(200)
  expect(result.headers.get('cache-control')).toContain('no-store')
  expect(String(fetcher.mock.calls[0][0])).toBe('https://project.supabase.co/auth/v1/token?grant_type=password')
  expect(fetcher.mock.calls[0][1].headers.get('apikey')).toBe('public-key')
})
it('returns retryable 503 instead of a logout-inducing error on upstream timeout', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('timeout', 'TimeoutError')))
  const result = await POST(new NextRequest('https://merchant.test/api/auth/bridge/token?grant_type=refresh_token', {
    method: 'POST', body: JSON.stringify({ refresh_token: 'dummy' }),
  }), context(['token']))
  expect(result.status).toBe(503)
  expect(await result.text()).not.toContain('dummy')
})
it('rejects unexpected routes, grants and foreign origins before contacting upstream', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
  expect((await GET(new NextRequest('https://merchant.test/api/auth/bridge/admin/users'), context(['admin', 'users']))).status).toBe(404)
  expect((await POST(new NextRequest('https://merchant.test/api/auth/bridge/token?grant_type=unknown', { method: 'POST' }), context(['token']))).status).toBe(400)
  expect((await POST(new NextRequest('https://merchant.test/api/auth/bridge/token?grant_type=password', { method: 'POST', headers: { origin: 'https://foreign.test' } }), context(['token']))).status).toBe(403)
  expect(fetcher).not.toHaveBeenCalled()
})
it('preserves successful logout responses without inventing a body', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))
  expect((await POST(new NextRequest('https://merchant.test/api/auth/bridge/logout', { method: 'POST' }), context(['logout']))).status).toBe(204)
})
it('routes browser login and refresh through the same-origin bridge', async () => {
  vi.stubGlobal('window', {})
  const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true })); vi.stubGlobal('fetch', fetcher)
  await browserAuthFetch('https://project.supabase.co')('https://project.supabase.co/auth/v1/token?grant_type=password', { method: 'POST' })
  expect(fetcher.mock.calls[0][0]).toBe('/api/auth/bridge/token?grant_type=password')
})
it('decodes only the matching project cookie, including numbered chunks', () => {
  const value = 'base64-' + Buffer.from(JSON.stringify({ access_token: 'signed-token' })).toString('base64url')
  const cookies = [{ name: 'sb-project-auth-token.1', value: value.slice(10) }, { name: 'sb-project-auth-token.0', value: value.slice(0, 10) }]
  expect(accessTokenFromCookies(cookies, 'https://project.supabase.co')).toBe('signed-token')
  expect(accessTokenFromCookies(cookies, 'https://other.supabase.co')).toBeNull()
  expect(accessTokenFromCookies(cookies.slice(0, 1), 'https://project.supabase.co')).toBeNull()
  expect(tokenNeedsRefresh('malformed')).toBe(true)
})

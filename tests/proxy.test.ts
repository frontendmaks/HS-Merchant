import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ claims: vi.fn(), create: vi.fn() }))
vi.mock('@supabase/ssr', () => ({ createServerClient: mocks.create }))
import { proxy } from '@/proxy'
const token = (exp = Math.floor(Date.now() / 1000) + 30) => `header.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.signature`
function request(jwt = token()) {
  const cookie = 'base64-' + Buffer.from(JSON.stringify({ access_token: jwt, refresh_token: 'refresh' })).toString('base64url')
  return new NextRequest('https://example.test/orders', { headers: { cookie: `sb-project-auth-token=${cookie}` } })
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co')
  mocks.claims.mockResolvedValue({ data: null })
  mocks.create.mockReturnValue({ auth: { getClaims: mocks.claims } })
})
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers() })
it('serves login without contacting Auth even with an old cookie', async () => {
  const result = await proxy(new NextRequest('https://example.test/login', { headers: { cookie: 'sb-session=old' } }))
  expect(result.headers.get('x-middleware-next')).toBe('1')
  expect(mocks.create).not.toHaveBeenCalled()
})
it('does not let an anonymous caller read protected pages', async () => {
  expect((await proxy(new NextRequest('https://example.test/orders'))).headers.get('location')).toBe('https://example.test/login')
  expect(mocks.claims).not.toHaveBeenCalled()
})
it('verifies a valid token near expiry without eager session refresh', async () => {
  mocks.claims.mockResolvedValue({ data: { claims: { sub: 'user' } }, error: null })
  const jwt = token()
  expect((await proxy(request(jwt))).headers.get('x-middleware-next')).toBe('1')
  expect(mocks.claims).toHaveBeenCalledExactlyOnceWith(jwt)
})
it('keeps the session cookie and shows retry on a transient Auth failure', async () => {
  mocks.claims.mockRejectedValue(new Error('network'))
  const result = await proxy(request())
  expect(result.status).toBe(503)
  expect(result.headers.get('location')).toBeNull()
  expect(result.headers.get('set-cookie')).toBeNull()
})
it('does not mistake an invalid signature for a verified user', async () => {
  mocks.claims.mockResolvedValue({ data: null, error: { status: 400, code: 'invalid_jwt' } })
  expect((await proxy(request())).headers.get('location')).toBe('https://example.test/login')
})
it('refreshes only an expired token and propagates the refreshed cookie', async () => {
  mocks.create.mockImplementation((_url, _key, options) => ({ auth: { getClaims: async (jwt?: string) => {
    expect(jwt).toBeUndefined()
    options.cookies.setAll([{ name: 'sb-project-auth-token', value: 'new-cookie', options: { path: '/' } }])
    return { data: { claims: { sub: 'user' } }, error: null }
  } } }))
  const result = await proxy(request(token(Math.floor(Date.now() / 1000) - 1)))
  expect(result.headers.get('x-middleware-next')).toBe('1')
  expect(result.headers.get('set-cookie')).toContain('new-cookie')
})
it('does not send the user to login when refresh is temporarily unavailable', async () => {
  mocks.claims.mockResolvedValue({ data: null, error: { status: 503, name: 'AuthRetryableFetchError' } })
  const result = await proxy(request(token(1)))
  expect(result.status).toBe(503)
  expect(result.headers.get('set-cookie')).toBeNull()
})

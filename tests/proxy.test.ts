import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ claims: vi.fn(), create: vi.fn() }))
vi.mock('@supabase/ssr', () => ({ createServerClient: mocks.create }))
import { proxy } from '@/proxy'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.claims.mockResolvedValue({ data: null })
  mocks.create.mockReturnValue({ auth: { getClaims: mocks.claims } })
})
it('serves login without contacting Auth even with an old cookie', async () => {
  const result = await proxy(new NextRequest('https://example.test/login', { headers: { cookie: 'sb-session=old' } }))
  expect(result.headers.get('x-middleware-next')).toBe('1')
  expect(mocks.create).not.toHaveBeenCalled()
})
it('does not let an anonymous caller read protected pages', async () => {
  const result = await proxy(new NextRequest('https://example.test/orders'))
  expect(result.headers.get('location')).toBe('https://example.test/login')
})
it('keeps protected pages available with verified claims', async () => {
  mocks.claims.mockResolvedValue({ data: { claims: { sub: 'user' } } })
  expect((await proxy(new NextRequest('https://example.test/orders'))).headers.get('x-middleware-next')).toBe('1')
})
it('returns a retry path instead of crashing on Auth network failure', async () => {
  mocks.claims.mockRejectedValue(new Error('network'))
  expect((await proxy(new NextRequest('https://example.test/orders'))).headers.get('location')).toContain('/login?retry=1')
})

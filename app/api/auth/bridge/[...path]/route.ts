import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 30
const allowed = new Map([
  ['token', new Set(['POST'])],
  ['user', new Set(['GET', 'PUT'])],
  ['logout', new Set(['POST'])],
  ['.well-known/jwks.json', new Set(['GET'])],
])

/** Fixed upstream and allowlist: never an arbitrary proxy or a service-role client. */
async function forward(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params
  const route = path.join('/')
  if (!allowed.get(route)?.has(req.method)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const origin = req.headers.get('origin')
  if (origin && origin !== req.nextUrl.origin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const upstream = new URL(`/auth/v1/${route}`, process.env.NEXT_PUBLIC_SUPABASE_URL!)
  upstream.search = req.nextUrl.search
  if (route === 'token' && !['password', 'refresh_token', 'pkce'].includes(upstream.searchParams.get('grant_type') ?? '')) {
    return NextResponse.json({ error: 'Unsupported grant' }, { status: 400 })
  }
  const headers = new Headers({ apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, 'Content-Type': 'application/json' })
  for (const name of ['authorization', 'x-client-info', 'x-supabase-api-version']) {
    const value = req.headers.get(name)
    if (value) headers.set(name, value)
  }
  const body = req.method === 'GET' ? undefined : await req.text()
  if (body && Buffer.byteLength(body) > 16384) return NextResponse.json({ error: 'Request too large' }, { status: 413 })
  try {
    const response = await fetch(upstream, { method: req.method, headers, body, cache: 'no-store', signal: AbortSignal.timeout(20000) })
    return new NextResponse(response.status === 204 ? null : await response.text(), { status: response.status, headers: {
      'Content-Type': response.headers.get('content-type') ?? 'application/json',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    } })
  } catch {
    // 503 is retryable by Supabase: a temporary network failure must not clear a session.
    return NextResponse.json({ error: 'temporarily_unavailable', message: 'Авторизація тимчасово недоступна. Повторіть спробу.' },
      { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '3' } })
  }
}
export { forward as GET, forward as POST, forward as PUT }

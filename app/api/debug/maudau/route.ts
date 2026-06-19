import { NextResponse } from 'next/server'

const BASE = process.env.MAUDAU_BASE!
const LOGIN = process.env.MAUDAU_LOGIN!
const PASSWORD = process.env.MAUDAU_PASSWORD!

export async function GET() {
  // 1. Try both login endpoints and show raw response
  const loginAttempts: Record<string, unknown> = {}

  for (const path of ['/login', '/v1/merchant_public_api/login']) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: LOGIN, password: PASSWORD }),
      })
      const body = await res.json()
      loginAttempts[path] = { status: res.status, body }
    } catch (e) {
      loginAttempts[path] = { error: String(e) }
    }
  }

  // 2. Get JWT from whichever worked
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const loginResult = (loginAttempts['/login'] as any)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const loginResult2 = (loginAttempts['/v1/merchant_public_api/login'] as any)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jwt: string = loginResult?.body?.data?.jwt ?? loginResult?.body?.jwt
    ?? loginResult2?.body?.data?.jwt ?? loginResult2?.body?.jwt ?? ''

  // 3. Try fetching orders with different params
  const orderTests: Record<string, unknown> = {}

  if (jwt) {
    const headers = { Authorization: `Bearer ${jwt}` }

    // Test 1: no filter (just page 1)
    try {
      const r = await fetch(`${BASE}/v1/merchant_public_api/orders?page=1&per_page=5`, { headers })
      const b = await r.json()
      orderTests['no_filter'] = { status: r.status, keys: Object.keys(b), ordersCount: b.orders?.length ?? b.data?.orders?.length ?? (Array.isArray(b) ? b.length : '?'), sample: JSON.stringify(b).slice(0, 500) }
    } catch (e) { orderTests['no_filter'] = { error: String(e) } }

    // Test 2: created_from date
    try {
      const r = await fetch(`${BASE}/v1/merchant_public_api/orders?page=1&per_page=5&created_from=2026-01-01`, { headers })
      const b = await r.json()
      orderTests['created_from_date'] = { status: r.status, sample: JSON.stringify(b).slice(0, 500) }
    } catch (e) { orderTests['created_from_date'] = { error: String(e) } }

    // Test 3: created_from ISO
    try {
      const r = await fetch(`${BASE}/v1/merchant_public_api/orders?page=1&per_page=5&created_from=2026-01-01T00:00:00.000Z`, { headers })
      const b = await r.json()
      orderTests['created_from_iso'] = { status: r.status, sample: JSON.stringify(b).slice(0, 500) }
    } catch (e) { orderTests['created_from_iso'] = { error: String(e) } }

    // Test 4: updated_from (2h ago, known to work)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString().split('T')[0]
    try {
      const r = await fetch(`${BASE}/v1/merchant_public_api/orders?page=1&per_page=5&updated_from=${twoHoursAgo}`, { headers })
      const b = await r.json()
      orderTests['updated_from'] = { status: r.status, sample: JSON.stringify(b).slice(0, 500) }
    } catch (e) { orderTests['updated_from'] = { error: String(e) } }
  }

  return NextResponse.json({
    base: BASE,
    loginAttempts,
    jwtObtained: !!jwt,
    jwtPreview: jwt ? jwt.slice(0, 20) + '...' : null,
    orderTests,
  })
}

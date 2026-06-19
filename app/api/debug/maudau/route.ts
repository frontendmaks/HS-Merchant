import { NextResponse } from 'next/server'

const BASE = process.env.MAUDAU_BASE!
const LOGIN = process.env.MAUDAU_LOGIN!
const PASSWORD = process.env.MAUDAU_PASSWORD!

async function getJwt() {
  const res = await fetch(`${BASE}/v1/merchant_public_api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: LOGIN, password: PASSWORD }),
  })
  const d = await res.json()
  return (d.data?.jwt ?? d.jwt) as string
}

export async function GET() {
  const jwt = await getJwt()
  const headers = { Authorization: `Bearer ${jwt}` }

  const results: Record<string, unknown> = {}

  // 1. Total count — big per_page, no filter
  {
    const r = await fetch(`${BASE}/v1/merchant_public_api/orders?page=1&per_page=100`, { headers })
    const b = await r.json()
    const arr = Array.isArray(b) ? b : (b.orders ?? b.data?.orders ?? [])
    results['total_100'] = {
      count: arr.length,
      dates: arr.map((o: Record<string, unknown>) => o.created_at).slice(0, 10),
    }
  }

  // 2. Page 2 — does pagination work?
  {
    const r = await fetch(`${BASE}/v1/merchant_public_api/orders?page=2&per_page=10`, { headers })
    const b = await r.json()
    const arr = Array.isArray(b) ? b : (b.orders ?? b.data?.orders ?? [])
    results['page2_per10'] = {
      count: arr.length,
      dates: arr.map((o: Record<string, unknown>) => o.created_at).slice(0, 5),
    }
  }

  // 3. created_from Jan 1 — how many orders?
  {
    const r = await fetch(`${BASE}/v1/merchant_public_api/orders?page=1&per_page=100&created_from=2026-01-01`, { headers })
    const b = await r.json()
    const arr = Array.isArray(b) ? b : (b.orders ?? b.data?.orders ?? [])
    results['created_from_jan1_100'] = {
      count: arr.length,
      dates: arr.map((o: Record<string, unknown>) => o.created_at),
    }
  }

  // 4. created_from May 1 — only May+
  {
    const r = await fetch(`${BASE}/v1/merchant_public_api/orders?page=1&per_page=100&created_from=2026-05-01`, { headers })
    const b = await r.json()
    const arr = Array.isArray(b) ? b : (b.orders ?? b.data?.orders ?? [])
    results['created_from_may1_100'] = {
      count: arr.length,
      dates: arr.map((o: Record<string, unknown>) => o.created_at),
    }
  }

  // 5. updated_from May 1
  {
    const r = await fetch(`${BASE}/v1/merchant_public_api/orders?page=1&per_page=100&updated_from=2026-05-01`, { headers })
    const b = await r.json()
    const arr = Array.isArray(b) ? b : (b.orders ?? b.data?.orders ?? [])
    results['updated_from_may1_100'] = {
      count: arr.length,
      dates: arr.map((o: Record<string, unknown>) => o.created_at),
    }
  }

  return NextResponse.json(results)
}

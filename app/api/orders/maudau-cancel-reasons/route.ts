import { NextResponse } from 'next/server'

async function getMaudauJwt(): Promise<string> {
  const res = await fetch(`${process.env.MAUDAU_BASE}/v1/merchant_public_api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.MAUDAU_LOGIN, password: process.env.MAUDAU_PASSWORD }),
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await res.json()
  return data.data?.jwt ?? data.jwt
}

export async function GET() {
  try {
    const jwt = await getMaudauJwt()
    const res = await fetch(`${process.env.MAUDAU_BASE}/v1/merchant_public_api/cancellation_reasons`, {
      headers: { Authorization: `Bearer ${jwt}` },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json()

    const reasons: { id: number; name: string }[] =
      data?.data ?? data?.reasons ?? (Array.isArray(data) ? data : [])

    return NextResponse.json(
      { reasons },
      { headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=86400' } },
    )
  } catch (e) {
    return NextResponse.json(
      { reasons: [], error: e instanceof Error ? e.message : String(e) },
    )
  }
}

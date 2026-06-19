import { NextResponse } from 'next/server'

async function getMaudauJwt(): Promise<string> {
  const res = await fetch(`${process.env.MAUDAU_BASE}/v1/merchant_public_api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.MAUDAU_LOGIN, password: process.env.MAUDAU_PASSWORD }),
  })
  const data = await res.json()
  return data.data.jwt
}

export async function GET() {
  try {
    const jwt = await getMaudauJwt()
    const res = await fetch(`${process.env.MAUDAU_BASE}/v1/merchant_public_api/cancellation_reasons`, {
      headers: { Authorization: `Bearer ${jwt}` },
    })
    const data = await res.json()
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

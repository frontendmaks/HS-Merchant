import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

async function getMaudauJwt(): Promise<string> {
  const res = await fetch(`${process.env.MAUDAU_BASE}/v1/merchant_public_api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.MAUDAU_LOGIN, password: process.env.MAUDAU_PASSWORD }),
  })
  const data = await res.json()
  return data.data.jwt
}

async function patchMaudauOrder(numericId: string, body: object, jwt: string) {
  const res = await fetch(`${process.env.MAUDAU_BASE}/v1/merchant_public_api/orders/${numericId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const put = await fetch(`${process.env.MAUDAU_BASE}/v1/merchant_public_api/orders/${numericId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify(body),
    })
    if (!put.ok) throw new Error(`MauDau TTN update failed: ${put.status}`)
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { ttn, platform, external_id } = await req.json()

  const supabase = createServiceClient()
  const { error: dbError } = await supabase
    .from('orders')
    .update({ ttn, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (dbError) return NextResponse.json({ success: false, error: dbError.message }, { status: 500 })

  try {
    if (platform === 'maudau') {
      const numericId = external_id.replace(/^MD-/, '')
      const jwt = await getMaudauJwt()
      await patchMaudauOrder(numericId, { status: 'approved' }, jwt)
      await patchMaudauOrder(numericId, { ttn, status: 'delivering' }, jwt)
    } else if (platform === 'rozetka') {
      const numericId = external_id.replace(/^RZ-/, '')
      const putRes = await fetch(`${process.env.ROZETKA_BASE}/orders/${numericId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.ROZETKA_TOKEN}` },
        body: JSON.stringify({ ttn }),
      })
      if (!putRes.ok) throw new Error(`Rozetka TTN update failed: ${putRes.status}`)
    }
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

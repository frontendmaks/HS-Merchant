import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

const ROZETKA_CANCEL_IDS = new Set([11, 12, 13, 15, 16, 17, 18, 19, 24, 25, 28, 29, 30, 31, 40, 42, 44, 45, 50])

async function getMaudauJwt(): Promise<string> {
  const res = await fetch(`${process.env.MAUDAU_BASE}/v1/merchant_public_api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.MAUDAU_LOGIN, password: process.env.MAUDAU_PASSWORD }),
  })
  const data = await res.json()
  return data.data.jwt
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { reason, platform, external_id } = await req.json()

  const supabase = createServiceClient()
  const { error: dbError } = await supabase
    .from('orders')
    .update({ status: 'Скасовано', cancel_reason: reason, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (dbError) return NextResponse.json({ success: false, error: dbError.message }, { status: 500 })

  try {
    if (platform === 'maudau') {
      const numericId = external_id.replace(/^MD-/, '')
      const jwt = await getMaudauJwt()
      const reasonsRes = await fetch(`${process.env.MAUDAU_BASE}/v1/merchant_public_api/cancellation_reasons`, {
        headers: { Authorization: `Bearer ${jwt}` },
      })
      const reasonsData = await reasonsRes.json()
      const reasons: { id: number; name: string }[] = reasonsData?.data || reasonsData || []
      const match = reasons.find(r => r.name === reason)
      const body: Record<string, unknown> = { status: 'canceled' }
      if (match) body.cancellation_reason_id = match.id
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
        if (!put.ok) throw new Error(`MauDau cancel failed: ${put.status}`)
      }
    } else if (platform === 'rozetka') {
      const numericId = external_id.replace(/^RZ-/, '')
      const detailRes = await fetch(`${process.env.ROZETKA_BASE}/orders/${numericId}`, {
        headers: { Authorization: `Bearer ${process.env.ROZETKA_TOKEN}` },
      })
      const detail = await detailRes.json()
      const statusAvailable: { child_id: number; title: string }[] = detail?.data?.status_available || []
      const cancelOption = statusAvailable.find(s => ROZETKA_CANCEL_IDS.has(s.child_id))
      if (!cancelOption) throw new Error('No cancel status available for this Rozetka order')
      const putRes = await fetch(`${process.env.ROZETKA_BASE}/orders/${numericId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.ROZETKA_TOKEN}` },
        body: JSON.stringify({ status: cancelOption.child_id }),
      })
      if (!putRes.ok) throw new Error(`Rozetka cancel failed: ${putRes.status}`)
    }
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

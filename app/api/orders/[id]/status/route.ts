import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

const MAUDAU_STATUS_MAP: Record<string, string> = {
  'Нове': 'new_order',
  'Прийнято': 'accepted',
  'Узгоджено': 'approved',
  'На доставці': 'delivering',
  'Прибуло': 'arrived',
  'Доставлено': 'completed',
  'Скасовано': 'canceled',
}

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
    if (!put.ok) throw new Error(`MauDau update failed: ${put.status}`)
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { status, platform, external_id } = await req.json()

  const supabase = createServiceClient()
  const { error: dbError } = await supabase
    .from('orders')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (dbError) return NextResponse.json({ success: false, error: dbError.message }, { status: 500 })

  try {
    if (platform === 'maudau') {
      const apiStatus = MAUDAU_STATUS_MAP[status]
      if (!apiStatus) throw new Error(`Unknown MauDau status: ${status}`)
      const numericId = external_id.replace(/^MD-/, '')
      const jwt = await getMaudauJwt()
      if (apiStatus === 'delivering') {
        await patchMaudauOrder(numericId, { status: 'approved' }, jwt)
      }
      await patchMaudauOrder(numericId, { status: apiStatus }, jwt)
    } else if (platform === 'rozetka') {
      const numericId = external_id.replace(/^RZ-/, '')
      const detailRes = await fetch(`${process.env.ROZETKA_BASE}/orders/${numericId}`, {
        headers: { Authorization: `Bearer ${process.env.ROZETKA_TOKEN}` },
      })
      const detail = await detailRes.json()
      const statusAvailable: { child_id: number; title: string }[] = detail?.data?.status_available || []
      const targetMap: Record<string, string[]> = {
        'Нове': ['Нове'],
        'Опрацьовується': ['Опрацьовується'],
        'Комплектується': ['Комплектується'],
        'Передано в доставку': ['Передано в доставку'],
        'Доставляється': ['Доставляється'],
        'Чекає в пункті': ['Чекає в пункті'],
        'Доставлено': ['Доставлено'],
        'Скасовано': ['Скасовано'],
      }
      const titles = targetMap[status] || [status]
      const match = statusAvailable.find(s => titles.some(t => s.title?.includes(t)))
      if (!match) throw new Error(`Status "${status}" not available for this Rozetka order`)
      const putRes = await fetch(`${process.env.ROZETKA_BASE}/orders/${numericId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.ROZETKA_TOKEN}` },
        body: JSON.stringify({ status: match.child_id }),
      })
      if (!putRes.ok) throw new Error(`Rozetka update failed: ${putRes.status}`)
    }
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

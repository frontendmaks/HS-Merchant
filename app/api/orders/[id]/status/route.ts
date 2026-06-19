import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getMaudauJwt, patchMaudauStatus } from '@/lib/maudau'

const MAUDAU_STATUS_MAP: Record<string, string> = {
  'Нове': 'new_order',
  'Прийнято': 'accepted',
  'Узгоджено': 'approved',
  'На доставці': 'delivering',
  'Прибуло': 'arrived',
  'Доставлено': 'completed',
  'Скасовано': 'canceled',
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const { status, platform, external_id } = (await req.json()) as {
    status: string
    platform: string
    external_id: string
  }

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

      // Cancellation must go through the cancel route (needs a reason)
      if (apiStatus === 'canceled') {
        return NextResponse.json({ success: true })
      }

      const numericId = external_id.replace(/^MD-/, '')
      const jwt = await getMaudauJwt()

      // MauDau requires approved before delivering
      if (apiStatus === 'delivering') {
        try { await patchMaudauStatus(numericId, 'approved', undefined, jwt) } catch { /* continue */ }
      }

      await patchMaudauStatus(numericId, apiStatus, undefined, jwt)
    } else if (platform === 'rozetka') {
      const numericId = external_id.replace(/^RZ-/, '')

      const detailRes = await fetch(`${process.env.ROZETKA_BASE}/orders/${numericId}`, {
        headers: { Authorization: `Bearer ${process.env.ROZETKA_TOKEN}` },
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const detail: any = await detailRes.json()

      const statusAvailable: { child_id: number; title: string }[] =
        detail?.data?.status_available ?? detail?.content?.status_available ?? []

      const match = statusAvailable.find(s =>
        s.title?.toLowerCase().includes(status.toLowerCase()),
      )

      if (!match) {
        return NextResponse.json(
          { success: false, error: 'Статус недоступний для цього замовлення' },
          { status: 500 },
        )
      }

      const putRes = await fetch(`${process.env.ROZETKA_BASE}/orders/${numericId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.ROZETKA_TOKEN}`,
        },
        body: JSON.stringify({ status: match.child_id }),
      })
      if (!putRes.ok) {
        const errBody = await putRes.text().catch(() => '')
        throw new Error(`Rozetka update failed: ${putRes.status} ${errBody.slice(0, 200)}`)
      }
    }
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    )
  }

  return NextResponse.json({ success: true })
}

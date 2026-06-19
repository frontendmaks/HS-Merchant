import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getMaudauJwt } from '@/lib/maudau'

const ROZETKA_CANCEL_IDS = new Set([11, 12, 13, 15, 16, 17, 18, 19, 24, 25, 28, 29, 30, 31, 40, 42, 44, 45, 50])
// IDs considered "in-progress" or "completed" — not valid cancels
const ROZETKA_ACTIVE_IDS = new Set([1, 2, 3, 4, 5, 6, 7, 20, 26, 52, 54, 55])

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const { reason, platform, external_id } = (await req.json()) as {
    reason: string
    platform: string
    external_id: string
  }

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

      // Fetch cancellation reasons and find best match
      const reasonsRes = await fetch(`${process.env.MAUDAU_BASE}/v1/merchant_public_api/cancellation_reasons`, {
        headers: { Authorization: `Bearer ${jwt}` },
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reasonsData: any = await reasonsRes.json()
      const reasons: { id: number; name: string }[] = reasonsData?.data ?? reasonsData ?? []

      let match = reasons.find(r => r.name === reason)
      if (!match) {
        match = reasons.find(
          r =>
            r.name.toLowerCase().includes(reason.toLowerCase()) ||
            reason.toLowerCase().includes(r.name.toLowerCase()),
        )
      }

      const body: Record<string, unknown> = { status: 'canceled' }
      if (match) body.cancellation_reason_id = match.id

      const { patchMaudauOrder } = await import('@/lib/maudau')
      await patchMaudauOrder(numericId, body, jwt)
    } else if (platform === 'rozetka') {
      const numericId = external_id.replace(/^RZ-/, '')

      const detailRes = await fetch(`${process.env.ROZETKA_BASE}/orders/${numericId}`, {
        headers: { Authorization: `Bearer ${process.env.ROZETKA_TOKEN}` },
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const detail: any = await detailRes.json()
      const statusAvailable: { child_id: number; title: string }[] =
        detail?.data?.status_available ?? detail?.content?.status_available ?? []

      // Prefer known cancel IDs; fall back to anything that isn't an active/completed status
      let cancelOption = statusAvailable.find(s => ROZETKA_CANCEL_IDS.has(s.child_id))
      if (!cancelOption) {
        cancelOption = statusAvailable.find(s => !ROZETKA_ACTIVE_IDS.has(s.child_id))
      }
      if (!cancelOption) throw new Error('No cancel status available for this Rozetka order')

      const putRes = await fetch(`${process.env.ROZETKA_BASE}/orders/${numericId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.ROZETKA_TOKEN}`,
        },
        body: JSON.stringify({ status: cancelOption.child_id }),
      })
      if (!putRes.ok) throw new Error(`Rozetka cancel failed: ${putRes.status}`)
    }
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    )
  }

  return NextResponse.json({ success: true })
}

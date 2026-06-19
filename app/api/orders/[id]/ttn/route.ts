import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getMaudauJwt, patchMaudauOrder } from '@/lib/maudau'

interface RozetkaStatusEntry {
  child_id: number
  title: string
}

async function fetchRozetkaOrder(numericId: string): Promise<{
  statusAvailable: RozetkaStatusEntry[]
}> {
  const res = await fetch(`${process.env.ROZETKA_BASE}/orders/${numericId}`, {
    headers: { Authorization: `Bearer ${process.env.ROZETKA_TOKEN}` },
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const detail: any = await res.json()
  const statusAvailable: RozetkaStatusEntry[] =
    detail?.data?.status_available ?? detail?.content?.status_available ?? []
  return { statusAvailable }
}

async function advanceRozetka(
  numericId: string,
  targetId: number,
  statusAvailable: RozetkaStatusEntry[],
): Promise<void> {
  const entry = statusAvailable.find(s => s.child_id === targetId)
  if (!entry) return // already past this step or not available — skip
  await fetch(`${process.env.ROZETKA_BASE}/orders/${numericId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.ROZETKA_TOKEN}`,
    },
    body: JSON.stringify({ status: entry.child_id }),
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const { ttn, platform, external_id } = (await req.json()) as {
    ttn: string
    platform: string
    external_id: string
  }

  const supabase = createServiceClient()
  const { error: dbError } = await supabase
    .from('orders')
    .update({ ttn, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (dbError) return NextResponse.json({ success: false, error: dbError.message }, { status: 500 })

  try {
    if (platform === 'maudau') {
      // Spec: must chain accepted → approved → delivering+TTN
      const numericId = external_id.replace(/^MD-/, '')
      const jwt = await getMaudauJwt()

      try { await patchMaudauOrder(numericId, { status: 'accepted' }, jwt) } catch { /* continue */ }
      try { await patchMaudauOrder(numericId, { status: 'approved' }, jwt) } catch { /* continue */ }
      // Main step — throw on failure
      await patchMaudauOrder(numericId, { ttn, status: 'delivering' }, jwt)
    } else if (platform === 'rozetka') {
      // Spec: chain 1→26→2, then set TTN + advance to 3
      const numericId = external_id.replace(/^RZ-/, '')

      // Step 1: advance to 26 (Опрацьовується)
      const { statusAvailable: sa1 } = await fetchRozetkaOrder(numericId)
      await advanceRozetka(numericId, 26, sa1)

      // Step 2: advance to 2 (Комплектується)
      const { statusAvailable: sa2 } = await fetchRozetkaOrder(numericId)
      await advanceRozetka(numericId, 2, sa2)

      // Step 3: set TTN + advance to 3 (Передано)
      const { statusAvailable: sa3 } = await fetchRozetkaOrder(numericId)
      const transferEntry = sa3.find(s => s.child_id === 3)

      if (transferEntry) {
        await fetch(`${process.env.ROZETKA_BASE}/orders/${numericId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.ROZETKA_TOKEN}`,
          },
          body: JSON.stringify({ status: transferEntry.child_id, ttn }),
        })
      } else {
        // TTN may be settable separately even without status advance
        await fetch(`${process.env.ROZETKA_BASE}/orders/${numericId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.ROZETKA_TOKEN}`,
          },
          body: JSON.stringify({ ttn }),
        })
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

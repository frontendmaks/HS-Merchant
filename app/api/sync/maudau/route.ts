import { NextResponse } from 'next/server'
import { requireWrite } from '@/lib/api-guard'
import { syncMaudau } from '@/lib/sync-maudau'

export async function POST() {
  const denied = await requireWrite('syncs')
  if (denied) return denied

  try {
    const { synced } = await syncMaudau()
    return NextResponse.json({ success: true, synced })
  } catch (err) {
    console.error('MauDau sync error:', err)
    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 }
    )
  }
}

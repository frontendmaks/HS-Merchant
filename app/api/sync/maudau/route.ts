import { NextResponse } from 'next/server'
import { syncMaudau } from '@/lib/sync-maudau'

export async function POST() {
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

import { NextResponse } from 'next/server'
import { requireWrite } from '@/lib/api-guard'
import { syncRozetka } from '@/lib/sync-rozetka'

export async function POST() {
  const denied = await requireWrite('syncs')
  if (denied) return denied

  try {
    const { synced } = await syncRozetka()
    return NextResponse.json({ success: true, synced })
  } catch (err) {
    console.error('Rozetka sync error:', err)
    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 }
    )
  }
}

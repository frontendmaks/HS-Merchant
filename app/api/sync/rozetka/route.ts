import { NextResponse } from 'next/server'
import { syncRozetka } from '@/lib/sync-rozetka'

export async function POST() {
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

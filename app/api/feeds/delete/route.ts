import { createServiceClient } from '@/lib/supabase/service'
import { NextRequest, NextResponse } from 'next/server'
import { requireWrite } from '@/lib/api-guard'

export async function DELETE(request: NextRequest) {
  const denied = await requireWrite('feeds')
  if (denied) return denied

  const { id } = await request.json()
  if (!id) return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 })

  const supabase = createServiceClient()
  const { error } = await supabase.from('feeds').delete().eq('id', id)

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

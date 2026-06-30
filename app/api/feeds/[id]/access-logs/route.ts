import { createServiceClient } from '@/lib/supabase/service'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createServiceClient()

  const { data: logs } = await supabase
    .from('feed_access_logs')
    .select('accessed_at, offers_count, errors_count, errors, auto_synced')
    .eq('feed_id', id)
    .gte('accessed_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    .order('accessed_at', { ascending: false })
    .limit(50)

  return NextResponse.json({ logs: logs ?? [] })
}

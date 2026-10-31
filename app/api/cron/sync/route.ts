export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { syncWoocommerce } from '@/lib/sync-woocommerce'
import { createServiceClient } from '@/lib/supabase/service'
import { logCronRun } from '@/lib/cron-log'

// Vercel викликає cron-ендпоінти з заголовком Authorization: Bearer <CRON_SECRET>
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const service = createServiceClient()
  const startedAt = Date.now()
  try {
    const result = await syncWoocommerce('cron', null)
    await logCronRun(service, 'wc-catalog', startedAt, result)
    return NextResponse.json({ triggered_by: 'cron', success: true, ...result })
  } catch (err) {
    await logCronRun(service, 'wc-catalog', startedAt, null, String(err))
    return NextResponse.json({ triggered_by: 'cron', success: false, error: String(err) }, { status: 500 })
  }
}

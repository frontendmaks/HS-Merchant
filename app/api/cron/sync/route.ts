import { NextRequest, NextResponse } from 'next/server'
import { syncWoocommerce } from '@/lib/sync-woocommerce'

// Vercel викликає cron-ендпоінти з заголовком Authorization: Bearer <CRON_SECRET>
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await syncWoocommerce('cron', null)
    return NextResponse.json({ triggered_by: 'cron', success: true, ...result })
  } catch (err) {
    return NextResponse.json({ triggered_by: 'cron', success: false, error: String(err) }, { status: 500 })
  }
}

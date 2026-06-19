import { NextRequest, NextResponse } from 'next/server'

// Vercel викликає cron-ендпоінти з заголовком Authorization: Bearer <CRON_SECRET>
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Делегуємо до основного sync ендпоінту
  const origin = request.nextUrl.origin
  const res = await fetch(`${origin}/api/sync/woocommerce`, {
    method: 'POST',
    headers: { 'x-cron': '1' },
  })

  const data = await res.json()
  return NextResponse.json({ triggered_by: 'cron', ...data })
}

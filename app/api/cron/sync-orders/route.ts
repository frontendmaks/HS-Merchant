import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret') || req.headers.get('authorization')?.replace('Bearer ', '')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const base = process.env.NEXT_PUBLIC_SITE_URL || `https://${req.headers.get('host')}`

  const [maudau, rozetka] = await Promise.allSettled([
    fetch(`${base}/api/sync/maudau`, { method: 'POST' }).then(r => r.json()),
    fetch(`${base}/api/sync/rozetka`, { method: 'POST' }).then(r => r.json()),
  ])

  return NextResponse.json({
    maudau: maudau.status === 'fulfilled' ? maudau.value : { error: String((maudau as PromiseRejectedResult).reason) },
    rozetka: rozetka.status === 'fulfilled' ? rozetka.value : { error: String((rozetka as PromiseRejectedResult).reason) },
  })
}

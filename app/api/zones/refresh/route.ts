import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor } from '@/lib/order-events'
import { refreshZones } from '@/lib/delivery-zones'
import { refreshSundayZones } from '@/lib/sunday-zones'

/**
 * POST /api/zones/refresh
 *
 * Звірити обидві карти з першоджерелом просто зараз.
 *
 * Уночі це роблять проходи, і здебільшого того досить. Але межі правлять
 * удень — і тоді між «намальовано» й «за чим їздимо» стоїть ціла доба.
 * Кнопка прибирає цю добу.
 */
export async function POST() {
  if (!await currentActor()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const service = createServiceClient()
  const [weekday, sunday] = await Promise.all([
    refreshZones(service),
    refreshSundayZones(service),
  ])

  const problems = [
    weekday.error ? `будні: ${weekday.error}` : null,
    sunday.error ? `неділя: ${sunday.error}` : null,
  ].filter(Boolean)

  return NextResponse.json({
    weekday, sunday,
    said: problems.length
      ? problems.join('; ')
      : `Звірено: будні — ${weekday.updated} зон, неділя — ${sunday.updated}`,
  })
}

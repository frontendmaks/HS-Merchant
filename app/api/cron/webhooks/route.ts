export const maxDuration = 120

import { NextRequest, NextResponse } from 'next/server'
import { deliverWebhooks } from '@/lib/integration-webhooks'

/**
 * Друга спроба для вебхуків, які не пройшли з першого разу.
 *
 * Основна відправка йде одразу після зміни. Сюди потрапляє те, що не
 * доставилось: Бітрікс лежав, мережа впала, таймаут. Раз на п'ять хвилин
 * черга перебирається заново з наростаючими паузами.
 */
export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    return NextResponse.json({ ok: true, ...(await deliverWebhooks()) })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}

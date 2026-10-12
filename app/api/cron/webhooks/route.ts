export const maxDuration = 120

import { NextRequest, NextResponse } from 'next/server'
import { deliverWebhooks } from '@/lib/integration-webhooks'
import { createServiceClient } from '@/lib/supabase/service'

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
    const result = await deliverWebhooks()

    // Раз на годину прибираємо історію: журнал звернень при 120 запитах за
    // хвилину — це 170 тисяч рядків на добу, і без чистки вони лишались би
    // назавжди
    if (new Date().getMinutes() < 5) {
      await createServiceClient().rpc('prune_integration_history')
    }

    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { uploadRozetkaItems } from '@/lib/rozetka-run'
import { logCronRun } from '@/lib/cron-log'

export const maxDuration = 300

/**
 * Ціни й залишки на Rozetka.
 *
 * Щогодини — оновлення: ціна з категорії «Маркетплейс» і залишок зі
 * складу. Раз на добу (`?create=1`) — ще й заведення карток, яких там
 * іще немає, порціями: створення йде поштучно, і чотириста карток за
 * один прохід не влізуть ні в час функції, ні в терпіння Rozetka.
 *
 * `?approve=1` віддає картки на модерацію. У розкладі його немає
 * навмисно: заявка на модерацію — дія в один бік, і вирішує її людина,
 * а не крон.
 */
export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const create = url.searchParams.get('create') === '1'
  const createLimit = Number(url.searchParams.get('limit') ?? 60)
  const approve = url.searchParams.get('approve') === '1'

  const service = createServiceClient()
  const startedAt = Date.now()

  try {
    const result = await uploadRozetkaItems(service, { updateOnly: !create, createLimit, approve })
    await logCronRun(service, 'rozetka-items', startedAt, {
      ...result,
      /* Журнал читають очима, а чотириста назв у ньому читати нема як */
      skipped: result.skipped.length,
      errors: result.errors.slice(0, 10),
    })
    return NextResponse.json(result)
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    await logCronRun(service, 'rozetka-items', startedAt, null, error)
    return NextResponse.json({ error }, { status: 500 })
  }
}

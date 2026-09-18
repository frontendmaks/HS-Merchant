export const maxDuration = 300

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor } from '@/lib/order-events'
import { getCurrentRole, canAccess } from '@/lib/getRole'
import { runPriceCheck } from '@/lib/price-run'

/** The latest pass, for the page to follow while it runs. */
export async function GET() {
  if (!await currentActor()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient()
  const [{ data }, { count: queued }] = await Promise.all([
    service.from('price_runs')
      .select('id, status, total, done, matched, missed, current_step, error, started_at, finished_at')
      .order('started_at', { ascending: false })
      .limit(1).single(),
    // Сторінки, які ще чекають на збирач. Прогін на сервері може вже
    // завершитись, а робота — ні: магазини, що не віддають сторінки серверу,
    // дочитуються браузером, і «готово» до того моменту було б неправдою.
    service.from('price_render_tasks')
      .select('id', { count: 'exact', head: true })
      .in('status', ['pending', 'taken']),
  ])

  return NextResponse.json({ run: data ?? null, queued: queued ?? 0 })
}

export async function POST(req: Request) {
  const actor = await currentActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canAccess('priceMonitor', await getCurrentRole())) {
    return NextResponse.json({ error: 'Немає доступу' }, { status: 403 })
  }

  // Checking one row is a different, much shorter job than a full pass, so it
  // does not queue behind one or block the next
  const { productId } = await req.json().catch(() => ({})) as { productId?: string }

  const service = createServiceClient()

  // One at a time. Two passes over the same competitors would double the
  // requests we send them and race each other writing the same rows.
  const { data: active } = await service
    .from('price_runs').select('id, started_at').eq('status', 'running')
    .order('started_at', { ascending: false }).limit(1).single()

  if (active) {
    const age = Date.now() - new Date(active.started_at).getTime()
    // A run that outlived the function that started it is not running any more
    if (age < 10 * 60_000) {
      return NextResponse.json({ error: 'Перевірка вже виконується', runId: active.id }, { status: 409 })
    }
    await service.from('price_runs')
      .update({ status: 'failed', error: 'Перервано', finished_at: new Date().toISOString() })
      .eq('id', active.id)
  }

  const { data: run } = await service.from('price_runs')
    .insert({
      started_by: actor.id,
      trigger: productId ? 'single' : 'manual',
      current_step: 'Готуємось…',
    })
    .select('id').single()

  const runId = run?.id as string | undefined

  try {
    const result = await runPriceCheck(service, runId, productId)
    if (runId) {
      await service.from('price_runs').update({
        status: 'done', done: result.matched + result.missed,
        matched: result.matched, missed: result.missed,
        current_step: null, finished_at: new Date().toISOString(),
        error: result.errors.length ? result.errors.join('; ') : null,
      }).eq('id', runId)
    }
    return NextResponse.json({ ok: true, runId, ...result })
  } catch (e) {
    if (runId) {
      await service.from('price_runs').update({
        status: 'failed', error: String(e), finished_at: new Date().toISOString(),
      }).eq('id', runId)
    }
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}

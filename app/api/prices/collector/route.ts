export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { createServiceClient } from '@/lib/supabase/service'
import { storeRendered } from '@/lib/price-render'

/**
 * The collector's end of the line.
 *
 *   GET  → up to a few pages that need a real browser
 *   POST → the rendered HTML of one of them
 *
 * The collector is deliberately dumb: it opens a URL and sends back what the
 * browser drew. Parsing, matching and the per-kilogram arithmetic stay on this
 * side, so a second copy of that logic never has to be kept in step.
 */
const hash = (key: string) => createHash('sha256').update(key).digest('hex')

async function authorize(req: NextRequest) {
  const header = req.headers.get('authorization') ?? ''
  const key = header.replace(/^Bearer\s+/i, '').trim()
  if (!key) return null

  const service = createServiceClient()
  const { data } = await service
    .from('price_collector_keys').select('id, name').eq('key_hash', hash(key)).single()

  if (!data) return null
  await service.from('price_collector_keys')
    .update({ last_seen_at: new Date().toISOString() }).eq('id', data.id)
  return data
}

export async function GET(req: NextRequest) {
  const caller = await authorize(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient()
  const stale = new Date(Date.now() - 10 * 60_000).toISOString()

  // Anything a collector took and never finished goes back in the queue
  await service.from('price_render_tasks')
    .update({ status: 'pending', taken_at: null })
    .eq('status', 'taken').lt('taken_at', stale)

  const { data: tasks } = await service
    .from('price_render_tasks')
    .select('id, url, query')
    .eq('status', 'pending')
    .order('created_at')
    .limit(5)

  if (tasks?.length) {
    await service.from('price_render_tasks')
      .update({ status: 'taken', taken_at: new Date().toISOString() })
      .in('id', tasks.map(t => t.id))
  }

  return NextResponse.json({ tasks: tasks ?? [] })
}

export async function POST(req: NextRequest) {
  const caller = await authorize(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, html, error } = await req.json() as {
    id: string; html?: string; error?: string
  }
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const service = createServiceClient()

  if (error || !html) {
    await service.from('price_render_tasks').update({
      status: 'failed', error: error ?? 'Порожня сторінка',
      done_at: new Date().toISOString(),
    }).eq('id', id)
    return NextResponse.json({ ok: true, stored: 0 })
  }

  const stored = await storeRendered(service, id, html)
  return NextResponse.json({ ok: true, stored })
}

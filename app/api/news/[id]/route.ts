/**
 *   PATCH  { title?, body?, audience?, publish?, read? } — edit, publish, or
 *          simply mark as read
 *   DELETE — remove it
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor } from '@/lib/order-events'
import { getCurrentRole } from '@/lib/getRole'
import { canWriteNews, seesAllNews, AUDIENCE_ROLES, MIN_NEWS_TITLE } from '@/lib/news'
import { cleanNewsHtml } from '@/lib/news-html'
import { announce } from '../route'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await currentActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const payload = await req.json() as {
    title?: string; body?: string; audience?: string[]
    publish?: boolean; read?: boolean
  }
  const supabase = createServiceClient()

  // Marking something read is not editing it — anyone who can see a piece may
  // say they have seen it
  if (payload.read) {
    await supabase.from('news_reads')
      .upsert({ news_id: id, user_id: actor.id }, { onConflict: 'news_id,user_id' })
    return NextResponse.json({ ok: true })
  }

  const role = await getCurrentRole()
  if (!canWriteNews(role)) {
    return NextResponse.json({ error: 'Немає прав' }, { status: 403 })
  }

  const { data: before } = await supabase
    .from('news').select('status, audience, title, body').eq('id', id).maybeSingle()
  if (!before) return NextResponse.json({ error: 'Новину не знайдено' }, { status: 404 })

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (payload.title !== undefined) {
    const headline = payload.title.trim()
    if (headline.length < MIN_NEWS_TITLE) {
      return NextResponse.json({ error: 'Вкажіть заголовок' }, { status: 400 })
    }
    update.title = headline
  }
  if (payload.body !== undefined) update.body = cleanNewsHtml(payload.body)
  if (payload.audience !== undefined) {
    update.audience = payload.audience.filter(r => (AUDIENCE_ROLES as string[]).includes(r))
  }

  const wasPublished = before.status === 'published'
  if (payload.publish === true) {
    const roles = (update.audience ?? before.audience) as string[]
    if (!roles?.length) {
      return NextResponse.json({ error: 'Оберіть, кому адресована новина' }, { status: 400 })
    }
    update.status = 'published'
    if (!wasPublished) update.published_at = new Date().toISOString()
  } else if (payload.publish === false) {
    update.status = 'draft'
  }

  const { error } = await supabase.from('news').update(update).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Announced once, when it first goes out. Editing a typo afterwards must not
  // ring everyone's bell again.
  if (payload.publish === true && !wasPublished) {
    await announce(
      supabase, id,
      (update.title as string) ?? before.title,
      (update.body as string) ?? before.body,
      (update.audience ?? before.audience) as string[],
    )
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await currentActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = await getCurrentRole()
  if (!seesAllNews(role)) return NextResponse.json({ error: 'Немає прав' }, { status: 403 })

  const { id } = await params
  const supabase = createServiceClient()
  const { error } = await supabase.from('news').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export const dynamic = 'force-dynamic'

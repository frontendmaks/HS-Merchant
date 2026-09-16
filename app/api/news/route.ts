/**
 *   GET   — announcements this person may read
 *   POST  { title, body, audience, publish } — write one
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor } from '@/lib/order-events'
import { getCurrentRole } from '@/lib/getRole'
import { canWriteNews, seesAllNews, MIN_NEWS_TITLE, AUDIENCE_ROLES } from '@/lib/news'
import { cleanNewsHtml, newsExcerpt } from '@/lib/news-html'

type Service = ReturnType<typeof createServiceClient>

export async function GET() {
  const actor = await currentActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = await getCurrentRole()

  const supabase = createServiceClient()
  let query = supabase
    .from('news')
    .select('*, author:profiles!news_author_id_fkey(full_name, email)')
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(200)

  // Everyone else sees what was published and addressed to them — drafts are
  // the writer's own business until they say otherwise
  if (!seesAllNews(role)) {
    query = query.eq('status', 'published').contains('audience', [role ?? ''])
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ news: data ?? [] })
}

export async function POST(req: NextRequest) {
  const actor = await currentActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = await getCurrentRole()
  if (!canWriteNews(role)) {
    return NextResponse.json({ error: 'Новини пишуть керівництво й адміністратори' }, { status: 403 })
  }

  const { title, body, audience, publish } = await req.json() as {
    title?: string; body?: string; audience?: string[]; publish?: boolean
  }

  const headline = (title ?? '').trim()
  if (headline.length < MIN_NEWS_TITLE) {
    return NextResponse.json({ error: 'Вкажіть заголовок' }, { status: 400 })
  }

  const roles = (audience ?? []).filter(r => (AUDIENCE_ROLES as string[]).includes(r))
  if (publish && !roles.length) {
    return NextResponse.json(
      { error: 'Оберіть, кому адресована новина' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const html = cleanNewsHtml(body ?? '')

  const { data: row, error } = await supabase.from('news').insert({
    author_id: actor.id,
    title: headline,
    body: html,
    audience: roles,
    status: publish ? 'published' : 'draft',
    published_at: publish ? new Date().toISOString() : null,
  }).select('id').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (publish) await announce(supabase, row.id, headline, html, roles)

  return NextResponse.json({ ok: true, id: row.id })
}

/** Tells the addressed roles there is something to read. */
export async function announce(
  supabase: Service, id: string, title: string, html: string, roles: string[],
) {
  if (!roles.length) return

  const { data: people } = await supabase
    .from('profiles').select('id').eq('is_active', true).in('role', roles)
  if (!people?.length) return

  await supabase.from('notifications').insert(people.map(p => ({
    user_id: p.id,
    type: 'news',
    title: `Новина · ${title}`,
    body: newsExcerpt(html, 120),
    link: `/news#${id}`,
  })))
}

export const dynamic = 'force-dynamic'

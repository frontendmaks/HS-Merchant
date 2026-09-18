import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor } from '@/lib/order-events'
import { getCurrentRole, canAccess } from '@/lib/getRole'

async function guard() {
  const actor = await currentActor()
  if (!actor) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!canAccess('priceMonitor', await getCurrentRole())) {
    return { error: NextResponse.json({ error: 'Немає доступу' }, { status: 403 }) }
  }
  return { actor }
}

/** A search address we can actually ask a question of. */
function validate(siteUrl: string, searchUrl: string): string | null {
  try {
    const site = new URL(siteUrl)
    const search = new URL(searchUrl.replace('{q}', 'test'))
    if (!['http:', 'https:'].includes(site.protocol)) return 'Посилання має починатися з http'
    if (!['http:', 'https:'].includes(search.protocol)) return 'Посилання має починатися з http'
  } catch {
    return 'Некоректне посилання'
  }
  if (!searchUrl.includes('{q}')) {
    return 'В адресі пошуку має бути {q} — місце, куди підставиться назва товару'
  }
  return null
}

export async function POST(req: NextRequest) {
  const g = await guard(); if (g.error) return g.error

  const { name, site_url, search_url } = await req.json() as Record<string, string>
  if (!name?.trim()) return NextResponse.json({ error: 'Вкажіть назву' }, { status: 400 })

  const problem = validate(site_url ?? '', search_url ?? '')
  if (problem) return NextResponse.json({ error: problem }, { status: 400 })

  const { data, error } = await createServiceClient()
    .from('price_competitors')
    .insert({
      name: name.trim().slice(0, 80),
      site_url: site_url.trim(),
      search_url: search_url.trim(),
      created_by: g.actor!.id,
    })
    .select('id').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, id: data.id })
}

export async function PATCH(req: NextRequest) {
  const g = await guard(); if (g.error) return g.error
  const { id, is_active } = await req.json() as { id: string; is_active: boolean }

  const { error } = await createServiceClient()
    .from('price_competitors').update({ is_active: !!is_active }).eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const g = await guard(); if (g.error) return g.error
  const id = req.nextUrl.searchParams.get('id') ?? ''

  const { error } = await createServiceClient()
    .from('price_competitors').delete().eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

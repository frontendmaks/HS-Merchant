import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor } from '@/lib/order-events'
import { getCurrentRole, canAccess } from '@/lib/getRole'
import { discoverSearchUrl } from '@/lib/price-discover'

async function guard() {
  const actor = await currentActor()
  if (!actor) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!canAccess('priceMonitor', await getCurrentRole())) {
    return { error: NextResponse.json({ error: 'Немає доступу' }, { status: 403 }) }
  }
  return { actor }
}

/** Only checked when one was typed by hand — normally it is discovered. */
function validateSearch(searchUrl: string): string | null {
  try {
    const search = new URL(searchUrl.replace('{q}', 'test'))
    if (!['http:', 'https:'].includes(search.protocol)) return 'Посилання має починатися з http'
  } catch {
    return 'Некоректне посилання'
  }
  if (!searchUrl.includes('{q}')) {
    return 'В адресі пошуку має бути {q} — місце, куди підставиться назва товару'
  }
  return null
}

export const maxDuration = 120

export async function POST(req: NextRequest) {
  const g = await guard(); if (g.error) return g.error

  const { name, site_url, search_url } = await req.json() as Record<string, string>
  if (!name?.trim()) return NextResponse.json({ error: 'Вкажіть назву' }, { status: 400 })

  try {
    const site = new URL(site_url ?? '')
    if (!['http:', 'https:'].includes(site.protocol)) {
      return NextResponse.json({ error: 'Посилання має починатися з http' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Некоректна адреса сайту' }, { status: 400 })
  }

  const service = createServiceClient()
  let searchUrl = (search_url ?? '').trim()
  let platform: string | null = null
  let note: string | null = null

  if (searchUrl) {
    const problem = validateSearch(searchUrl)
    if (problem) return NextResponse.json({ error: problem }, { status: 400 })
  } else {
    // Probed with a real product name rather than a made-up word: a search that
    // works on our assortment is the only kind worth storing
    const { data: sample } = await service
      .from('products').select('name')
      .eq('status', 'active').not('name', 'is', null).limit(1).single()

    const found = await discoverSearchUrl(site_url, sample?.name as string ?? 'молоко')
    searchUrl = found.searchUrl ?? ''
    platform = found.platform
    // No search is not a failure any more — the sitemap route handles it, and
    // saying otherwise made a working competitor look broken
    note = null
  }

  const { data, error } = await service
    .from('price_competitors')
    .insert({
      name: name.trim().slice(0, 80),
      site_url: site_url.trim(),
      search_url: searchUrl || null,
      created_by: g.actor!.id,
      last_error: note,
    })
    .select('id').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, id: data.id, searchUrl, platform, note })
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

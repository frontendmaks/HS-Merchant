/**
 * Pictures inside an announcement.
 *
 *   POST  multipart: file   uploads one, returns the src to put in the body
 *   GET   ?path=...         serves it
 *
 * The bucket is private and the stored HTML points here rather than at a
 * signed URL: a signed URL expires, and an announcement written today is still
 * read next month. Everything goes through this route, so the picture is only
 * visible to someone already signed in.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor } from '@/lib/order-events'
import { getCurrentRole } from '@/lib/getRole'
import { canWriteNews } from '@/lib/news'

const BUCKET = 'news-images'
const MAX_BYTES = 10 * 1024 * 1024
const ALLOWED = [
  'image/png', 'image/jpeg', 'image/jpg', 'image/webp',
  'image/gif', 'image/avif', 'image/heic', 'image/heif',
]

const EXT_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', avif: 'image/avif', heic: 'image/heic', heif: 'image/heif',
}

/** The browser's word for it, or the extension when it says nothing — a photo
 *  from a phone camera often arrives with an empty type. */
function resolveType(file: File): string | null {
  const declared = (file.type || '').toLowerCase()
  if (ALLOWED.includes(declared)) return declared
  const ext = (file.name.split('.').pop() ?? '').toLowerCase()
  return EXT_TYPES[ext] ?? null
}

export async function POST(req: NextRequest) {
  const actor = await currentActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canWriteNews(await getCurrentRole())) {
    return NextResponse.json({ error: 'Немає прав' }, { status: 403 })
  }

  const form = await req.formData()
  const file = form.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Файл не надіслано' }, { status: 400 })
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Зображення більше за 10 МБ' }, { status: 400 })
  }

  const type = resolveType(file)
  if (!type) return NextResponse.json({ error: 'Підтримуються лише зображення' }, { status: 400 })

  const ext = Object.entries(EXT_TYPES).find(([, t]) => t === type)?.[0] ?? 'bin'
  const path = `${new Date().getFullYear()}/${crypto.randomUUID()}.${ext}`

  const supabase = createServiceClient()
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, await file.arrayBuffer(), { contentType: type, upsert: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Exactly the shape lib/news-html.ts allows through
  return NextResponse.json({ ok: true, src: `/api/news/images?path=${path}` })
}

export async function GET(req: NextRequest) {
  const actor = await currentActor()
  if (!actor) return new NextResponse('Unauthorized', { status: 401 })

  const path = req.nextUrl.searchParams.get('path') ?? ''
  if (!/^[A-Za-z0-9/_.-]+$/.test(path) || path.includes('..')) {
    return new NextResponse('Bad path', { status: 400 })
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase.storage.from(BUCKET).download(path)
  if (error || !data) return new NextResponse('Not found', { status: 404 })

  return new NextResponse(await data.arrayBuffer(), {
    headers: {
      'Content-Type': data.type || 'application/octet-stream',
      // Private: cached by the reader's own browser, never by anything shared
      'Cache-Control': 'private, max-age=86400',
    },
  })
}

export const dynamic = 'force-dynamic'

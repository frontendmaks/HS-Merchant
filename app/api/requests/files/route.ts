/**
 * Files attached to a request's resolution.
 *
 *   POST  multipart: file, request_id   uploads one, returns its stored path
 *   GET   ?path=...                     a short-lived link to look at it
 *
 * The bucket is private. A screenshot of this panel can carry a customer's
 * name, phone and address, and a public bucket is one guessed URL away from
 * anyone — so every read goes through here, signed and expiring.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor } from '@/lib/order-events'

const BUCKET = 'request-files'
const MAX_BYTES = 15 * 1024 * 1024

/**
 * What a phone actually sends, not what a desktop browser does.
 *
 * An iPhone hands over HEIC unless the user changed a setting, and some Android
 * browsers send an empty type for a photo taken with the camera. Whitelisting
 * only the four desktop formats rejected both — which is why uploading from a
 * phone did nothing.
 */
const ALLOWED = [
  'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif',
  'image/heic', 'image/heif', 'image/avif', 'application/pdf',
]

const EXT_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', heic: 'image/heic', heif: 'image/heif', avif: 'image/avif',
  pdf: 'application/pdf',
}

/** The browser's word for it, or the extension when it says nothing. */
function resolveType(file: File): string | null {
  const declared = (file.type || '').toLowerCase()
  if (ALLOWED.includes(declared)) return declared
  if (declared && !declared.startsWith('image/')) return null

  const ext = (file.name.split('.').pop() ?? '').toLowerCase()
  return EXT_TYPES[ext] ?? (declared.startsWith('image/') ? declared : null)
}

export async function POST(req: NextRequest) {
  const actor = await currentActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const form = await req.formData()
  const file = form.get('file') as File | null
  const requestId = String(form.get('request_id') ?? '')
  if (!file) return NextResponse.json({ error: 'Файл не надіслано' }, { status: 400 })
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) {
    return NextResponse.json({ error: 'Некоректний запит' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Файл більший за 15 МБ' }, { status: 400 })
  }
  const contentType = resolveType(file)
  if (!contentType) {
    return NextResponse.json({ error: 'Приймаються зображення та PDF' }, { status: 400 })
  }

  // Named by us, not by the uploader: a filename is user input and has no
  // business deciding where a file lands
  const ext = (file.name.split('.').pop() ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5)
  const path = `${requestId}/${crypto.randomUUID()}${ext ? '.' + ext : ''}`

  const { error } = await createServiceClient().storage
    .from(BUCKET)
    .upload(path, await file.arrayBuffer(), { contentType, upsert: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    file: { path, name: file.name.slice(0, 120), size: file.size, type: contentType },
  })
}

export async function GET(req: NextRequest) {
  const actor = await currentActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const path = req.nextUrl.searchParams.get('path') ?? ''
  if (!path) return NextResponse.json({ error: 'path required' }, { status: 400 })

  const { data, error } = await createServiceClient().storage
    .from(BUCKET).createSignedUrl(path, 300)

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Файл не знайдено' }, { status: 404 })
  }
  return NextResponse.redirect(data.signedUrl)
}

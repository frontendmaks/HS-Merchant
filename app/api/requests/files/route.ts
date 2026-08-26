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
const MAX_BYTES = 10 * 1024 * 1024
const ALLOWED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf']

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
    return NextResponse.json({ error: 'Файл більший за 10 МБ' }, { status: 400 })
  }
  if (!ALLOWED.includes(file.type)) {
    return NextResponse.json({ error: 'Приймаються зображення та PDF' }, { status: 400 })
  }

  // Named by us, not by the uploader: a filename is user input and has no
  // business deciding where a file lands
  const ext = (file.name.split('.').pop() ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5)
  const path = `${requestId}/${crypto.randomUUID()}${ext ? '.' + ext : ''}`

  const { error } = await createServiceClient().storage
    .from(BUCKET)
    .upload(path, await file.arrayBuffer(), { contentType: file.type, upsert: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    file: { path, name: file.name.slice(0, 120), size: file.size, type: file.type },
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

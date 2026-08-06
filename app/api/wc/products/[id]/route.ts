import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

const WC_URL = process.env.WC_URL!
const CK = process.env.WC_CONSUMER_KEY!
const CS = process.env.WC_CONSUMER_SECRET!

function wcHeaders(extra?: Record<string, string>) {
  return { 'Content-Type': 'application/json', ...extra }
}

function wcUrl(path: string) {
  const sep = path.includes('?') ? '&' : '?'
  return `${WC_URL}/wp-json/wc/v3${path}${sep}consumer_key=${CK}&consumer_secret=${CS}`
}

async function getWcId(supabaseId: string): Promise<string | null> {
  const supabase = createServiceClient()
  const { data } = await supabase.from('products').select('external_id').eq('id', supabaseId).single()
  return data?.external_id ?? null
}

async function wcGet(wcId: string) {
  const res = await fetch(wcUrl(`/products/${wcId}`), {
    headers: wcHeaders(),
    cache: 'no-store',
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`WC ${res.status}: ${body.slice(0, 200)}`)
  }
  return res.json()
}

// GET — fetch real WC product data for the edit form
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const wcId = await getWcId(id)
  if (!wcId) return NextResponse.json({ error: 'Product not found or no external_id' }, { status: 404 })

  try {
    const p = await wcGet(wcId)
    return NextResponse.json({
      name: p.name ?? '',
      description: p.description ?? '',
      short_description: p.short_description ?? '',
      categories: (p.categories ?? []) as { id: number; name: string }[],
      images: (p.images ?? []).map((img: { id: number; src: string; alt: string; name: string }) => ({
        id: img.id,
        src: img.src,
        alt: img.alt ?? '',
        name: img.name ?? '',
      })),
      attributes: (p.attributes ?? []) as { name: string; options: string[] }[],
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'WC error' }, { status: 502 })
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()

  const supabase = createServiceClient()
  const { data: product } = await supabase
    .from('products')
    .select('external_id, attributes, images')
    .eq('id', id)
    .single()

  if (!product?.external_id) {
    return NextResponse.json({ error: 'Product not found or no external_id' }, { status: 404 })
  }

  const wcId = product.external_id

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wcPayload: Record<string, any> = {}

  if (body.name !== undefined) wcPayload.name = body.name
  if (body.description !== undefined) wcPayload.description = body.description
  if (body.short_description !== undefined) wcPayload.short_description = body.short_description

  if (body.categories !== undefined) {
    wcPayload.categories = body.categories.map((catId: number) => ({ id: catId }))
  }

  if (body.images !== undefined) {
    wcPayload.images = body.images.map((img: { id?: number; src: string; alt: string; name: string }) => ({
      id: img.id,
      src: img.src,
      alt: img.alt,
      name: img.name,
    }))
  }

  if (body.min !== undefined || body.step !== undefined) {
    try {
      const wcProduct = await wcGet(wcId)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existingAttrs: any[] = wcProduct.attributes ?? []
      const updateAttr = (name: string, value: string) => {
        const idx = existingAttrs.findIndex((a: { name: string }) => a.name === name)
        if (idx >= 0) existingAttrs[idx] = { ...existingAttrs[idx], options: [value] }
        else existingAttrs.push({ name, visible: true, options: [value] })
      }
      if (body.min !== undefined) updateAttr('Мін', String(body.min))
      if (body.step !== undefined) updateAttr('Вага', String(body.step))
      wcPayload.attributes = existingAttrs
    } catch { /* skip attrs update if WC fetch fails */ }
  }

  // Push to WC
  const wcRes = await fetch(wcUrl(`/products/${wcId}`), {
    method: 'PUT',
    headers: wcHeaders(),
    body: JSON.stringify(wcPayload),
  })

  if (!wcRes.ok) {
    const err = await wcRes.text()
    return NextResponse.json({ error: `WC ${wcRes.status}: ${err.slice(0, 300)}` }, { status: wcRes.status })
  }

  // Mirror to Supabase
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabaseUpdate: Record<string, any> = {}
  if (body.name !== undefined) supabaseUpdate.name = body.name
  if (body.description !== undefined) supabaseUpdate.description = body.description
  if (body.images !== undefined) supabaseUpdate.images = body.images.map((img: { src: string }) => img.src)
  if (body.min !== undefined || body.step !== undefined) {
    const attrs = (product.attributes as Record<string, string>) ?? {}
    if (body.min !== undefined) attrs['Мін'] = String(body.min)
    if (body.step !== undefined) attrs['Вага'] = String(body.step)
    supabaseUpdate.attributes = attrs
  }
  if (Object.keys(supabaseUpdate).length > 0) {
    await supabase.from('products').update(supabaseUpdate).eq('id', id)
  }

  return NextResponse.json({ success: true })
}

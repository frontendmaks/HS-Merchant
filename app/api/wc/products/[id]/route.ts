import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

const WC_URL = process.env.WC_URL!
const CK = process.env.WC_CONSUMER_KEY!
const CS = process.env.WC_CONSUMER_SECRET!

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()

  // id here is the Supabase product UUID — look up external_id for WC
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

  // Build WC update payload
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wcPayload: Record<string, any> = {}

  if (body.name !== undefined) wcPayload.name = body.name
  if (body.description !== undefined) wcPayload.description = body.description

  // Categories: array of {id: number}
  if (body.categories !== undefined) {
    wcPayload.categories = body.categories.map((catId: number) => ({ id: catId }))
  }

  // Images: update alt and name for existing images
  if (body.images !== undefined) {
    wcPayload.images = body.images
  }

  // Attributes: Мін and Крок
  if (body.min !== undefined || body.step !== undefined) {
    // Fetch current WC product to get existing attributes
    const wcRes = await fetch(
      `${WC_URL}/wp-json/wc/v3/products/${wcId}?consumer_key=${CK}&consumer_secret=${CS}`,
      { cache: 'no-store' }
    )
    const wcProduct = await wcRes.json()
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
  }

  // Push to WC
  const wcRes = await fetch(
    `${WC_URL}/wp-json/wc/v3/products/${wcId}?consumer_key=${CK}&consumer_secret=${CS}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(wcPayload),
    }
  )

  if (!wcRes.ok) {
    const err = await wcRes.text()
    return NextResponse.json({ error: err }, { status: wcRes.status })
  }

  // Update Supabase too
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

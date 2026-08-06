/**
 * POST /api/rozetka/upload-products
 *
 * Uploads products from a feed to Rozetka via the Items Create API.
 * For each active product:
 *   - If price_offer_id (SKU) already has a stored rozetka_item_id → mass-update
 *   - Otherwise → create new
 *
 * The mapping {sku: rozetka_item_id} is stored in feeds.settings.rozetka_item_ids.
 *
 * Required feed settings:
 *   settings.rozetka_category_id  — Rozetka category ID for all products in this feed
 *
 * Optional feed settings:
 *   settings.rozetka_params        — array of {our_attr_name, id, type} for attribute mapping
 *   settings.rozetka_producer_id   — Rozetka producer ID (0 = unknown, specify title)
 *   settings.rozetka_producer_name — producer name string
 */

import { createServiceClient } from '@/lib/supabase/service'
import { sanitizeSku } from '@/lib/transliterate'
import { NextRequest, NextResponse } from 'next/server'
import {
  rozetkaCreateItem,
  rozetkaUpdateItems,
  type RozetkaCreateItemPayload,
  type RozetkaUpdateItemPayload,
  type RozetkaParam,
} from '@/lib/rozetka-api'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const { feed_id } = await req.json()
    if (!feed_id) return NextResponse.json({ error: 'feed_id required' }, { status: 400 })

    const supabase = createServiceClient()

    const { data: feed, error } = await supabase
      .from('feeds')
      .select(`
        *,
        marketplace:marketplaces(*),
        feed_products(
          *,
          product:products(*)
        )
      `)
      .eq('id', feed_id)
      .single()

    if (error || !feed) {
      return NextResponse.json({ error: 'Feed not found' }, { status: 404 })
    }

    const settings = (feed.settings ?? {}) as Record<string, unknown>
    const categoryId = Number(settings.rozetka_category_id ?? 0)
    if (!categoryId) {
      return NextResponse.json(
        { error: 'Feed settings missing rozetka_category_id. Set it first.' },
        { status: 400 }
      )
    }

    // Existing sku→item_id mapping stored from previous uploads
    const storedIds = (settings.rozetka_item_ids ?? {}) as Record<string, number>

    // Attribute mapping: [{our_attr_name, id, type, values?: [{our_val, id}]}]
    const paramMapping = (settings.rozetka_params ?? []) as Array<{
      our_attr_name: string
      id: number
      type: string
      values?: Array<{ our_val: string; id: number; value: string }>
    }>

    const producerId = Number(settings.rozetka_producer_id ?? 0)
    const producerName = String(settings.rozetka_producer_name ?? '')

    const activeFps = feed.feed_products.filter((fp: any) => fp.is_active && fp.product)

    const toCreate: Array<{ sku: string; payload: RozetkaCreateItemPayload }> = []
    const toUpdate: Array<{ sku: string; payload: RozetkaUpdateItemPayload }> = []
    const skipped: string[] = []

    for (const fp of activeFps) {
      const p = fp.product
      const nameUa = fp.custom_name ?? p.name
      const price = fp.custom_price ?? p.price
      const stock = fp.custom_stock ?? p.stock ?? 0
      const sku = sanitizeSku(p.sku || String(p.external_id || p.id))

      if (!nameUa || !price) {
        skipped.push(sku || p.id)
        continue
      }

      const pictures = ((p.images as string[]) ?? [])
        .slice(0, 15)
        .map((url: string) => ({ link: url }))

      // Build params from attribute mapping
      const attrs = { ...(p.attributes as Record<string, string> ?? {}), ...(fp.custom_params ?? {}) }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const params: any[] = []
      for (const pm of paramMapping as any[]) {
        const rawVal = attrs[pm.our_attr_name as string]
        if (rawVal === undefined || rawVal === null || rawVal === '') continue
        const val = String(rawVal).trim()

        if (['List', 'ListValues', 'ComboBox', 'CheckBoxGroup', 'CheckBoxGroupValues'].includes(pm.type as string)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const matched = (pm.values as any[] | undefined)?.find((v: any) => v.our_val === val || v.value === val)
          if (!matched) continue
          params.push({ id: pm.id, title: pm.our_attr_name, type: pm.type, value: [{ id: matched.id, value: matched.value }] })
        } else if (pm.type === 'Integer') {
          params.push({ id: pm.id, title: pm.our_attr_name, type: pm.type, value: parseInt(val) || 0 })
        } else if (pm.type === 'Decimal') {
          params.push({ id: pm.id, title: pm.our_attr_name, type: pm.type, value: parseFloat(val) || 0 })
        } else if (pm.type === 'CheckBox') {
          params.push({ id: pm.id, title: pm.our_attr_name, type: pm.type, value: val === 'true' || val === '1' })
        } else {
          params.push({ id: pm.id, title: pm.our_attr_name, type: pm.type, value: val, value_ua: val })
        }
      }

      const commonFields = {
        name: nameUa,
        name_ua: nameUa,
        price: Math.round(price),
        stock_quantity: Math.ceil(stock > 0 ? stock : 0),
        price_offer_id: sku,
        pictures: pictures.length ? pictures : undefined,
        description: p.description ?? undefined,
        description_ua: p.description ?? undefined,
        article: p.sku ?? undefined,
        available: p.status === 'active' && stock > 0,
        is_approve: false as const,
        price_old: p.price_old ? Math.round(p.price_old) : undefined,
        producer: (producerName || p.brand)
          ? { id: producerId, title: producerName || (p.brand as string) || '' }
          : undefined,
        params: params.length ? params : undefined,
      }

      const existingItemId = storedIds[sku]
      if (existingItemId) {
        const updatePayload: RozetkaUpdateItemPayload = { ...commonFields, item_id: existingItemId }
        toUpdate.push({ sku, payload: updatePayload })
      } else {
        const createPayload: RozetkaCreateItemPayload = { ...commonFields, category_id: categoryId }
        toCreate.push({ sku, payload: createPayload })
      }
    }

    // Create new products (sequentially to avoid rate limiting)
    const created: Array<{ sku: string; item_id: number; sync_source_id: number }> = []
    const createErrors: Array<{ sku: string; error: string }> = []

    for (const { sku, payload } of toCreate) {
      try {
        const result = await rozetkaCreateItem(payload)
        created.push({ sku, ...result })
        storedIds[sku] = result.item_id
      } catch (e: any) {
        createErrors.push({ sku, error: e.message })
      }
    }

    // Mass-update existing products (batch)
    let updated = 0
    const updateErrors: string[] = []
    if (toUpdate.length > 0) {
      try {
        const BATCH = 20
        for (let i = 0; i < toUpdate.length; i += BATCH) {
          const batch = toUpdate.slice(i, i + BATCH).map(x => x.payload)
          updated += await rozetkaUpdateItems(batch)
        }
      } catch (e: any) {
        updateErrors.push(e.message)
      }
    }

    // Persist updated storedIds back to feeds.settings
    if (created.length > 0) {
      await supabase
        .from('feeds')
        .update({ settings: { ...settings, rozetka_item_ids: storedIds } })
        .eq('id', feed_id)
    }

    return NextResponse.json({
      success: true,
      created: created.length,
      updated,
      skipped: skipped.length,
      create_errors: createErrors,
      update_errors: updateErrors,
    })
  } catch (err: any) {
    console.error('rozetka/upload-products error:', err)
    return NextResponse.json({ error: err.message ?? 'Помилка' }, { status: 500 })
  }
}

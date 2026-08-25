/**
 * Rozetka Seller API — product upload helpers.
 *
 * Auth: lib/rozetka-auth.ts logs in and caches the 24-hour token. Rozetka
 * issues no permanent keys, so a token in an env var stops working within a day.
 * Base URL: ROZETKA_BASE env var.
 *
 * Key endpoints used:
 *   POST /items-create/create             — create a new product
 *   PUT  /items-create/mass-update-basic-data — update existing products (by item_id)
 *   GET  /items-create/categories         — lookup Rozetka category IDs
 *   GET  /items-create/attributes         — lookup attribute IDs for a category
 *   GET  /items-create/values             — lookup allowed values for an attribute
 */

import { rozetkaToken, invalidateRozetkaToken, isTokenError } from '@/lib/rozetka-auth'

const BASE = process.env.ROZETKA_BASE!

async function once<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await rozetkaToken()}`,
      'Content-Type': 'application/json',
      'Content-Language': 'uk',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = await res.json()
  if (!data.success) {
    const e = data.errors
    throw new Error(
      `Rozetka API error${e?.code ? ` ${e.code}` : ''}: ${e?.description ?? e?.message ?? JSON.stringify(e)}`,
    )
  }
  return data.content as T
}

/** One retry with a fresh token — a 24-hour token can lapse mid-upload. */
async function rz<T>(method: string, path: string, body?: unknown): Promise<T> {
  try {
    return await once<T>(method, path, body)
  } catch (e) {
    if (!isTokenError(e)) throw e
    invalidateRozetkaToken()
    return once<T>(method, path, body)
  }
}

export interface RozetkaCreateItemPayload {
  name: string
  name_ua: string
  category_id: number
  price: number
  stock_quantity: number
  price_offer_id?: string
  pictures?: Array<{ link: string }>
  description?: string
  description_ua?: string
  article?: string
  available?: boolean
  is_approve?: boolean
  price_old?: number
  producer?: { id: number; title: string }
  params?: RozetkaParam[]
}

export interface RozetkaParam {
  id: number
  title: string
  type: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any
  value_ua?: string
}

export interface RozetkaCreateItemResult {
  item_id: number
  sync_source_id: number
}

export interface RozetkaUpdateItemPayload extends Omit<RozetkaCreateItemPayload, 'category_id'> {
  item_id?: number
  rz_item_id?: number
}

/** Create a single product on Rozetka. Returns item_id and sync_source_id. */
export async function rozetkaCreateItem(payload: RozetkaCreateItemPayload): Promise<RozetkaCreateItemResult> {
  const content = await rz<{ item: RozetkaCreateItemResult }>('POST', '/items-create/create', payload)
  return content.item
}

/** Bulk-update existing products (by item_id). Returns how many were updated. */
export async function rozetkaUpdateItems(items: RozetkaUpdateItemPayload[]): Promise<number> {
  const content = await rz<{ items_updated: number }>('PUT', '/items-create/mass-update-basic-data', { items })
  return content.items_updated
}

/** List Rozetka categories for product creation. */
export async function rozetkaGetCategories(params?: {
  category_ids?: number[]
  title?: string
}): Promise<Array<{ id: number; title: string; is_vendor_required: number }>> {
  const qs = new URLSearchParams()
  if (params?.category_ids?.length) qs.set('category_ids[]', params.category_ids.join(','))
  if (params?.title) qs.set('title', params.title)
  const q = qs.toString() ? `?${qs}` : ''
  const content = await rz<{ categories: Array<{ id: number; title: string; is_vendor_required: number }> }>(
    'GET', `/items-create/categories${q}`
  )
  return content.categories ?? []
}

/** List attributes for a Rozetka category. */
export async function rozetkaGetAttributes(categoryId: number): Promise<Array<{
  id: number
  title: string
  type: string
}>> {
  const content = await rz<{ attributes: Array<{ id: number; title: string; type: string }> }>(
    'GET', `/items-create/attributes?category_id=${categoryId}`
  )
  return content.attributes ?? []
}

/** List allowed values for a Rozetka category attribute. */
export async function rozetkaGetAttributeValues(categoryId: number, attributeId: number): Promise<Array<{
  id: number
  value: string
  value_ua: string
}>> {
  const content = await rz<{ values: Array<{ id: number; value: string; value_ua: string }> }>(
    'GET', `/items-create/values?category_id=${categoryId}&attribute_id=${attributeId}`
  )
  return content.values ?? []
}

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

export interface RozetkaCategory {
  id: number
  title: string
  title_ru: string | null
  parent_id: number | null
  level: number | null
  mpath: string | null
  is_vendor_required: boolean
}

/** One page of categories. Rozetka caps a page at 100 whatever you ask for. */
async function categoryPage(page: number, title?: string): Promise<{
  rows: RozetkaCategory[]; pageCount: number
}> {
  const qs = new URLSearchParams({ page: String(page), pageSize: '100' })
  if (title) qs.set('title', title)
  const c = await rz<never>('GET', `/items-create/categories?${qs}`) as unknown as {
    categories?: RawCategory[]
    _meta?: { pageCount?: number }
  }
  return {
    rows: (c.categories ?? []).map(toCategory),
    pageCount: c._meta?.pageCount ?? 1,
  }
}

interface RawCategory {
  id: number
  title?: string
  title_ua?: string
  title_ru?: string
  parent_id?: number | null
  level?: number
  mpath?: string
  is_vendor_required?: number | boolean
}

const toCategory = (c: RawCategory): RozetkaCategory => ({
  id: c.id,
  title: c.title_ua || c.title || String(c.id),
  title_ru: c.title_ru ?? null,
  parent_id: c.parent_id ?? null,
  level: c.level ?? null,
  mpath: c.mpath ?? null,
  is_vendor_required: !!c.is_vendor_required,
})

/** Search categories by name — what the feed editor's picker calls. */
export async function rozetkaSearchCategories(title: string): Promise<RozetkaCategory[]> {
  return (await categoryPage(1, title)).rows
}

/** The whole tree, ~4700 rows over ~48 pages. Only the sync job needs this. */
export async function rozetkaAllCategories(
  onProgress?: (done: number, total: number) => void,
): Promise<RozetkaCategory[]> {
  const first = await categoryPage(1)
  const all = [...first.rows]
  for (let page = 2; page <= first.pageCount; page++) {
    all.push(...(await categoryPage(page)).rows)
    onProgress?.(page, first.pageCount)
  }
  return all
}

export interface RozetkaAttribute {
  id: number
  title: string
  type: string
  unit: string | null
  /** Only for the list-like types; empty otherwise */
  values: { id: number; value: string }[]
}

/** Types where Rozetka accepts only ids from its own value list. */
export const LIST_TYPES = ['List', 'ListValues', 'ComboBox', 'CheckBoxGroup', 'CheckBoxGroupValues']

/** Every attribute of a category, with the allowed values for list types.
 *  Two pagination traps here: the parameter is pageSize, not page_size (which
 *  is ignored, silently giving five rows out of twenty-six), and anything above
 *  100 is rejected outright as error 1005. */
export async function rozetkaAttributes(categoryId: number): Promise<RozetkaAttribute[]> {
  const raw: { id: number; title?: string; title_ua?: string; type: string; unit?: string }[] = []
  let page = 1
  let pageCount = 1
  do {
    const c = await rz<never>('GET',
      `/items-create/attributes?category_id=${categoryId}&page=${page}&pageSize=100`) as unknown as {
        attributes?: typeof raw
        _meta?: { pageCount?: number }
      }
    raw.push(...(c.attributes ?? []))
    pageCount = c._meta?.pageCount ?? 1
    page++
  } while (page <= pageCount)

  const attrs = raw.map(a => ({
    id: a.id,
    title: a.title_ua || a.title || String(a.id),
    type: a.type,
    unit: a.unit || null,
    values: [] as { id: number; value: string }[],
  }))

  // Values come one request per attribute, so only ask where they can exist
  for (const a of attrs) {
    if (!LIST_TYPES.includes(a.type)) continue
    try {
      a.values = await rozetkaAttributeValues(categoryId, a.id)
    } catch {
      // A missing value list should not sink the whole category
    }
  }
  return attrs
}

/** Allowed values for one list-type attribute. Paged — country lists run well
 *  past the hundred rows a single page returns. */
export async function rozetkaAttributeValues(categoryId: number, attributeId: number): Promise<
  { id: number; value: string }[]
> {
  const out: { id: number; value: string }[] = []
  let page = 1
  let pageCount = 1
  do {
    const c = await rz<never>('GET',
      `/items-create/values?category_id=${categoryId}&attribute_id=${attributeId}&page=${page}&pageSize=100`,
    ) as unknown as {
      // The key is attributeValues and the label is title_ua — not the `values`
      // / `value` the endpoint's name suggests, which reads as an empty list.
      attributeValues?: { id: number; title?: string; title_ua?: string }[]
      _meta?: { pageCount?: number }
    }
    out.push(...(c.attributeValues ?? []).map(v => ({
      id: v.id, value: v.title_ua || v.title || String(v.id),
    })))
    pageCount = c._meta?.pageCount ?? 1
    page++
  } while (page <= pageCount)
  return out
}

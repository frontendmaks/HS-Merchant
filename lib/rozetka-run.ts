/**
 * Прохід вивантаження на Rozetka.
 *
 * Дві дії, свідомо різні за частотою. Завести картку можна раз — далі
 * вона живе своїм життям і чекає модерації; змінити ціну й залишок
 * треба стільки разів, скільки вони міняються. Тому створення йде
 * рідко й поштучно, а оновлення — часто й пачками по двадцять.
 *
 * Товарний набір беремо з фіда Rozetka: там ті самі позиції, що й на
 * МауДау, і редактор фіда лишається єдиним місцем, де їх вмикають і
 * вимикають.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { loadPricing } from '@/lib/price-category'
import { loadPromos } from '@/lib/price-promo'
import {
  rozetkaCreateItem, rozetkaUpdateItems, rozetkaAttributes,
  type RozetkaUpdateItemPayload,
} from '@/lib/rozetka-api'
import { rozetkaProducerId } from '@/lib/rozetka-producers'
import {
  buildItem, basicFields, itemParams, needsUpdate,
  type RozetkaItemContext, type RozetkaItemDraft,
} from '@/lib/rozetka-items'
import { isTest } from '@/lib/env-mode'

type Service = ReturnType<typeof createServiceClient>

/** Фід Rozetka — один; шукаємо за майданчиком, а не за назвою */
async function rozetkaFeed(service: Service) {
  const { data } = await service
    .from('feeds')
    .select('id, settings, price_category_id, marketplace:marketplaces!inner(slug)')
    .eq('marketplaces.slug', 'rozetka')
    .limit(1)
    .maybeSingle()
  return data as { id: string; settings: Record<string, unknown>; price_category_id: string | null } | null
}

/**
 * Характеристика «Вага в упаковці» в цій категорії.
 *
 * Номер у неї свій у кожної категорії, і дізнатись його можна лише в
 * Rozetka. Запитане складаємо в `rozetka_categories.attributes` — там
 * воно вже потрібне редактору фіда, тож другого кешу не заводимо.
 */
const WEIGHT_TITLE = /вага в упаковці/i

async function weightAttrs(service: Service, categoryIds: number[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  if (!categoryIds.length) return out

  const { data } = await service
    .from('rozetka_categories').select('id, attributes').in('id', categoryIds)

  const known = new Map((data ?? []).map(c => [Number(c.id), c.attributes as unknown]))

  for (const id of categoryIds) {
    let attrs = known.get(id) as { id: number; title: string }[] | null | undefined

    if (!attrs?.length) {
      try {
        attrs = await rozetkaAttributes(id)
        await service.from('rozetka_categories')
          .update({ attributes: attrs, attributes_synced_at: new Date().toISOString() })
          .eq('id', id)
      } catch {
        /* Категорія без характеристик — картку в ній не заведемо, і про це
           скаже сама спроба; валити весь прохід через одну не варто */
        continue
      }
    }

    const found = attrs?.find(a => WEIGHT_TITLE.test(a.title ?? ''))
    if (found) out[String(id)] = Number(found.id)
  }
  return out
}

export interface UploadResult {
  looked: number
  created: number
  updated: number
  unchanged: number
  skipped: { name: string; reason: string }[]
  errors: { name: string; error: string }[]
}

export async function uploadRozetkaItems(
  service: Service,
  { createLimit = 40, updateOnly = false }: { createLimit?: number; updateOnly?: boolean } = {},
): Promise<UploadResult> {
  const out: UploadResult = { looked: 0, created: 0, updated: 0, unchanged: 0, skipped: [], errors: [] }

  const feed = await rozetkaFeed(service)
  if (!feed) throw new Error('Фіда Rozetka немає — нема з чого вивантажувати')

  const { data: rows } = await service
    .from('feed_products')
    .select('id, is_active, custom_price, custom_name, custom_stock, custom_params, price_category_id, product:products(*)')
    .eq('feed_id', feed.id)
    .eq('is_active', true)
    .limit(5000)

  const active = (rows ?? []).filter(r => r.product)
  out.looked = active.length
  if (!active.length) return out

  const settings = (feed.settings ?? {}) as Record<string, unknown>
  const categoryIds = (settings.rozetka_category_ids ?? {}) as Record<string, string>

  const [pricing, promos] = await Promise.all([
    loadPricing(service, feed as { price_category_id?: string | null }),
    loadPromos(service, feed.id),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const brands = [...new Set(active.map(r => String((r.product as any).brand ?? '').trim()).filter(Boolean))]
  const producerIds: Record<string, number> = {}
  for (const brand of brands) {
    const id = await rozetkaProducerId(service, brand)
    if (id) producerIds[brand] = id
  }

  const usedCategories = [...new Set(Object.values(categoryIds).map(Number).filter(Boolean))]
  const ctx: RozetkaItemContext = {
    categoryIds, producerIds,
    weightAttr: await weightAttrs(service, usedCategories),
    pricing, promos,
  }

  const { data: knownRows } = await service
    .from('rozetka_items')
    .select('product_id, item_id, price, price_old, stock, available')
  const known = new Map((knownRows ?? []).map(r => [r.product_id as string, r]))

  const drafts: RozetkaItemDraft[] = []
  for (const fp of active) {
    const built = buildItem(fp, ctx)
    if ('error' in built) out.skipped.push({ name: built.name, reason: built.error })
    else drafts.push(built.item)
  }

  /* Спершу оновлення: воно дешеве, пачками, і саме від нього залежать
     гроші на вітрині. Створення — слідом, і лише стільки, скільки
     влазить у прохід */
  const toUpdate = drafts.filter(d => known.has(d.productId))
  const batch: { draft: RozetkaItemDraft; payload: RozetkaUpdateItemPayload }[] = []
  for (const draft of toUpdate) {
    const sent = known.get(draft.productId)!
    if (!needsUpdate(draft, sent)) { out.unchanged++; continue }
    batch.push({ draft, payload: { item_id: Number(sent.item_id), ...basicFields(draft) } })
  }

  for (let i = 0; i < batch.length; i += 20) {
    const chunk = batch.slice(i, i + 20)
    try {
      await rozetkaUpdateItems(chunk.map(c => c.payload))
      out.updated += chunk.length
      await remember(service, chunk.map(c => c.draft), known)
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      for (const c of chunk) out.errors.push({ name: c.draft.name, error })
    }
  }

  if (updateOnly) return out

  const toCreate = drafts.filter(d => !known.has(d.productId)).slice(0, createLimit)
  for (const draft of toCreate) {
    const params = itemParams(draft)
    if (!params.length) {
      /* Дві різні біди, і плутати їх не можна: одна лагодиться в картці
         товару, друга — лише в Rozetka */
      out.skipped.push({
        name: draft.name,
        reason: draft.weightAttrId
          ? 'не знаємо ваги порції — ні в полях, ні в назві'
          : 'Rozetka не дала характеристик для цієї категорії',
      })
      continue
    }
    try {
      const created = await rozetkaCreateItem({
        ...basicFields(draft),
        category_id: draft.categoryId,
        is_approve: false,
        pictures: draft.pictures.map(link => ({ link })),
        description: draft.description,
        description_ua: draft.description,
        ...(draft.producer ? { producer: draft.producer } : {}),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        params: params as any,
      })
      if (isTest) continue
      await service.from('rozetka_items').upsert({
        product_id: draft.productId,
        item_id: created.item_id,
        offer_id: draft.offerId,
        category_id: draft.categoryId,
        price: draft.price,
        price_old: draft.priceOld,
        stock: draft.stock,
        available: draft.available,
        sent_at: new Date().toISOString(),
        error: null,
        updated_at: new Date().toISOString(),
      })
      out.created++
    } catch (e) {
      out.errors.push({ name: draft.name, error: e instanceof Error ? e.message : String(e) })
    }
  }

  return out
}

/** Запам'ятати те, що щойно віддали, — інакше наступний прохід віддасть знову */
async function remember(
  service: Service, drafts: RozetkaItemDraft[],
  known: Map<string, { item_id: number }>,
) {
  if (isTest || !drafts.length) return
  await service.from('rozetka_items').upsert(drafts.map(d => ({
    product_id: d.productId,
    item_id: Number(known.get(d.productId)!.item_id),
    offer_id: d.offerId,
    category_id: d.categoryId,
    price: d.price,
    price_old: d.priceOld,
    stock: d.stock,
    available: d.available,
    sent_at: new Date().toISOString(),
    error: null,
    updated_at: new Date().toISOString(),
  })))
}

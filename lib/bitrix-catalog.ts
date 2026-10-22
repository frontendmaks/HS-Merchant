/**
 * Каталог товарів Бітрікса — у нас під рукою.
 *
 * Наш каталог приходить із сайту, тож у ньому є лише те, що на сайті
 * викладено. А продають і те, чого там немає: голови курячі, субпродукти,
 * рештки розбирання — про них питають телефоном, і оператор мусив або
 * відмовити, або вписати назву з голови, і тоді 1С отримувала рядок, якого
 * не знає.
 *
 * У Бітріксі ці товари є — з власним номером, кодом 1С і одиницею виміру.
 * Тримаємо їх копію в себе: пошук під час розмови має відповідати одразу,
 * а не ходити по вісімдесят запитів до CRM.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { bitrix, bitrixCatalog, catalogConfigured } from '@/lib/bitrix'
import { fetchAllRows } from '@/lib/supabase/fetch-all'

type Service = ReturnType<typeof createServiceClient>

/** Скільки Бітрікс віддає за один раз */
const PAGE = 50

/**
 * Тип ціни «ОНЛАЙН».
 *
 * Фіксованої ціни в товара немає: у кожного магазину свій тип, їх
 * тридцять вісім — «маг.ЦУМ», «ГУРТІВНЯ», «ЛЬВІВ АС2». Для доставки
 * чинний онлайновий, і саме його має бачити оператор, бо саме цю ціну
 * почує покупець.
 */
export const ONLINE_PRICE_TYPE = 24

/**
 * Одиниці виміру за номером.
 *
 * Їх у портала тринадцять, але в товарах трапляються одиниці. Нас цікавить
 * одне розрізнення — вага чи штука: від нього залежить, що означає «два» в
 * рядку замовлення.
 */
const MEASURE: Record<string, string> = {
  2: 'л', 3: 'г', 4: 'кг', 5: 'шт', 6: 'шт', 7: 'пач', 10: 'кг', 12: 'л',
}

export const measureUnit = (id: string | null | undefined) =>
  MEASURE[String(id ?? '')] ?? 'шт'

interface Product {
  ID: string
  NAME: string
  XML_ID: string | null
  MEASURE: string | null
  SECTION_ID: string | null
}

export interface CatalogResult {
  seen: number
  saved: number
  skipped: number
  priced: number
}

/**
 * Перечитує активні товари Бітрікса.
 *
 * Без коду 1С товар не беремо: саме він зв'язує Бітрікс із нашим каталогом
 * і з 1С, а без нього рядок у замовленні лишається просто назвою.
 */
export async function syncBitrixCatalog(
  service: Service,
  { maxPages = 120 }: { maxPages?: number } = {},
): Promise<CatalogResult> {
  const result: CatalogResult = { seen: 0, saved: 0, skipped: 0, priced: 0 }
  const now = new Date().toISOString()

  for (let page = 0; page < maxPages; page++) {
    const batch = await bitrix<Product[]>('crm.product.list', {
      filter: { ACTIVE: 'Y' },
      select: ['ID', 'NAME', 'XML_ID', 'MEASURE', 'SECTION_ID'],
      order: { ID: 'ASC' },
      start: page * PAGE,
    })

    const items = batch ?? []
    if (!items.length) break
    result.seen += items.length

    const rows = items
      .filter(p => p.XML_ID && p.NAME)
      .map(p => ({
        uid_1c: p.XML_ID as string,
        product_id: Number(p.ID),
        name: p.NAME,
        measure: p.MEASURE ?? null,
        section_id: p.SECTION_ID ?? null,
        active: true,
        synced_at: now,
      }))

    result.skipped += items.length - rows.length

    if (rows.length) {
      await service.from('bitrix_products').upsert(rows, { onConflict: 'uid_1c' })
      result.saved += rows.length
    }

    if (items.length < PAGE) break
  }

  /*
   * Те, чого цей обхід не побачив, більше не активне.
   *
   * Товар прибрали з каталогу — він не має далі пропонуватись у підказках,
   * але й зникати йому не можна: на нього посилаються позиції старих
   * замовлень, і без рядка вони втратили б зв'язок із каталогом.
   */
  if (result.saved) {
    await service.from('bitrix_products')
      .update({ active: false })
      .or(`synced_at.is.null,synced_at.lt.${now}`)
  }

  result.priced = await syncOnlinePrices(service)

  return result
}

interface Price { productId: number; price: number }

/**
 * Онлайнові ціни — на товари, які ми вже знаємо.
 *
 * Ціни приходять окремим списком, не разом із товаром, і їх трохи менше,
 * ніж товарів: те, чого онлайн не продають, онлайнової ціни й не має.
 */
async function syncOnlinePrices(service: Service): Promise<number> {
  if (!catalogConfigured()) return 0

  const byProduct = new Map<number, number>()

  for (let page = 0; page < 200; page++) {
    const batch = await bitrixCatalog<{ prices?: Price[] }>('catalog.price.list', {
      filter: { catalogGroupId: ONLINE_PRICE_TYPE },
      select: ['productId', 'price'],
      order: { id: 'ASC' },
      start: page * PAGE,
    })

    const prices = batch?.prices ?? []
    if (!prices.length) break
    for (const p of prices) {
      if (Number(p.price) > 0) byProduct.set(Number(p.productId), Number(p.price))
    }
    if (prices.length < PAGE) break
  }

  if (!byProduct.size) return 0

  const now = new Date().toISOString()

  /*
   * Через сторінки: товарів у каталозі чотири тисячі.
   *
   * PostgREST віддає тисячу й мовчки обрізає решту — і ціна діставалась
   * лише тим вісімсот, що вмістились у першу сторінку. Решта лишалась
   * без ціни, хоч у Бітріксі вона стояла.
   */
  const known = await fetchAllRows<{ uid_1c: string; product_id: number }>(() =>
    service.from('bitrix_products').select('uid_1c, product_id') as unknown as {
      range: (from: number, to: number) => PromiseLike<{
        data: { uid_1c: string; product_id: number }[] | null; error: unknown
      }>
    })

  const rows = (known ?? [])
    .filter(k => byProduct.has(Number(k.product_id)))
    .map(k => ({
      uid_1c: k.uid_1c as string,
      product_id: Number(k.product_id),
      price: byProduct.get(Number(k.product_id)) as number,
      price_at: now,
    }))

  for (let i = 0; i < rows.length; i += 500) {
    await service.from('bitrix_products')
      .upsert(rows.slice(i, i + 500), { onConflict: 'uid_1c' })
  }

  return rows.length
}

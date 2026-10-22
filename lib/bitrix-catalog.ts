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
import { bitrix } from '@/lib/bitrix'

type Service = ReturnType<typeof createServiceClient>

/** Скільки Бітрікс віддає за один раз */
const PAGE = 50

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
  const result: CatalogResult = { seen: 0, saved: 0, skipped: 0 }
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

  return result
}

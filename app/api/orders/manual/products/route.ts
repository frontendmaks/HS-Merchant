import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor } from '@/lib/order-events'
import { measureUnit } from '@/lib/bitrix-catalog'

/**
 * GET /api/orders/manual/products
 *
 * Увесь каталог для ручного замовлення — одним списком.
 *
 * Раніше кожне натискання клавіші йшло в базу, і підказки з'являлись із
 * затримкою, помітною в розмові з клієнтом. Товарів дві тисячі — це менше,
 * ніж одна сторінка звіту, тож дешевше віддати їх один раз і шукати на місці:
 * підказка з'являється тієї ж миті, коли оператор домовляє слово.
 *
 * Віддаємо всі, а не лише активні: по телефону замовляють і те, що на сайті
 * зняте з продажу або закінчилось. Стан товару при цьому видно — оператор має
 * знати, що пропонує.
 */

export interface CatalogueItem {
  id: string
  name: string
  sku: string | null
  code_1c: string | null
  price: number
  unit: string
  pack: number | null
  stock: number | null
  status: string
  category: string | null
  /** Звідки товар: із нашого каталогу чи лише з Бітрікса */
  source?: 'site' | 'bitrix'
  /** Коли цей товар востаннє продавали за цією ціною */
  price_from?: string | null
  /** Номер товару в Бітріксі — щоб угода отримала саме його, а не назву */
  bitrix_product_id?: number
}

/** Каталог змінюється раз на синхронізацію, не раз на натискання клавіші. */
const TTL_MS = 5 * 60 * 1000
let cache: { at: number; items: CatalogueItem[] } | null = null

async function catalogue(): Promise<CatalogueItem[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.items

  const service = createServiceClient()
  const { data } = await service
    .from('products')
    .select('id, name, sku, code_1c, uid_1c, price, stock, unit, status, category_name, attributes')
    // Активні першими: по телефону здебільшого замовляють те, що є
    .order('status')
    .order('name')

  /*
   * Те, чого на сайті немає.
   *
   * Наш каталог приходить із сайту, тож у ньому лише викладене. А питають
   * і про інше — голови курячі, субпродукти, рештки розбирання. У Бітріксі
   * вони є, з власним номером і кодом 1С, і саме цей номер має потрапити в
   * угоду: назва, вписана з голови, для 1С нічого не означає.
   *
   * Ціни там немає — її називає оператор, бо такий товар і продається за
   * домовленістю.
   */
  const [{ data: fromBitrix }, { data: lastPrices }] = await Promise.all([
    service.from('bitrix_products')
      .select('product_id, uid_1c, name, measure')
      .eq('active', true)
      .order('name'),
    /*
     * Ціна — з історії продажів, бо в каталозі CRM її немає.
     *
     * Поле ціни порожнє в усіх 3988 товарах, а модуль «Торговий каталог»
     * для нашого вебхука закритий. Зате кожна угода несе ціну позиції — і
     * це та сама ціна, яку оператор називав останнього разу. Підставляємо
     * її й кажемо, коли це було: якщо відтоді змінилась, видно, що
     * перевірити.
     */
    service.from('bitrix_last_price').select('product_id, price, sold_on'),
  ])

  const priced = new Map(
    (lastPrices ?? []).map(r => [
      Number(r.product_id),
      { price: Number(r.price ?? 0), on: r.sold_on as string | null },
    ]),
  )

  const items = (data ?? []).map(p => {
    const attrs = (p.attributes as Record<string, string> | null) ?? {}
    const pack = Number(attrs['Мін'] ?? attrs['Крок'] ?? 0)
    return {
      id: p.id as string,
      name: p.name as string,
      sku: p.sku as string | null,
      code_1c: p.code_1c as string | null,
      price: Number(p.price ?? 0),
      /**
       * Одиниця — з атрибутів картки, не з колонки.
       *
       * У колонці `unit` в усіх товарів стоїть «шт», бо так їх рахує
       * WooCommerce. Справжня одиниця продажу — в атрибуті «Одиниця»:
       * філе продається кілограмами, консерви штуками, і замовлення на
       * «16 шт філе» замість «1.6 кг» це зовсім інша кількість.
       */
      unit: attrs['Одиниця'] || (p.unit as string) || 'шт',
      /** Крок продажу вагового товару: «0.4» означає фасування по 400 г */
      pack: pack > 0 ? pack : null,
      stock: p.stock == null ? null : Number(p.stock),
      status: p.status as string,
      category: p.category_name as string | null,
    }
  })

  /*
   * Наш каталог головніший.
   *
   * Якщо товар є на сайті, він має прийти з ціною, фасуванням і залишком,
   * а не голою назвою з CRM. Зводимо їх за кодом 1С — це той самий GUID
   * по обидва боки; `code_1c` тут не підходить, там артикул.
   *
   * Частина кодів приїхала з сайту в обгортці WPML — `[:en]…[:]`. Для
   * зведення вона зайва: той самий товар через неї виглядав би чужим.
   */
  const bare = (uid: string | null) =>
    (uid ?? '').replace(/^\[:[a-z]{2}\]/i, '').replace(/\[:\]$/, '').trim()

  const known = new Set(
    (data ?? []).map(p => bare(p.uid_1c as string | null)).filter(Boolean),
  )

  const extra: CatalogueItem[] = (fromBitrix ?? [])
    .filter(b => !known.has(bare(b.uid_1c as string)))
    .map(b => ({
      id: `bx-${b.product_id}`,
      name: b.name as string,
      sku: null,
      code_1c: b.uid_1c as string,
      price: priced.get(Number(b.product_id))?.price ?? 0,
      price_from: priced.get(Number(b.product_id))?.on ?? null,
      unit: measureUnit(b.measure as string | null),
      pack: null,
      stock: null,
      status: 'bitrix',
      category: null,
      source: 'bitrix' as const,
      bitrix_product_id: Number(b.product_id),
    }))

  const all = [...items.map(i => ({ ...i, source: 'site' as const })), ...extra]

  cache = { at: Date.now(), items: all }
  return all
}

export async function GET() {
  if (!await currentActor()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json({ products: await catalogue() }, {
    // Браузер теж не має перепитувати каталог під час однієї зміни
    headers: { 'Cache-Control': 'private, max-age=300' },
  })
}

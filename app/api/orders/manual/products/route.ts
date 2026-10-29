import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
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
  /**
   * Знімок товару з сайту.
   *
   * Оператор набирає зі слуху, а назви в каталозі схожі до нерозрізнення:
   * «Філе куряче» за 214 і «Філе куряче» за 378 — це грудка й мариноване,
   * і відрізняє їх тільки картинка. У Бітрікса знімків немає, тож там
   * лишається порожньо.
   */
  image?: string | null
}

/** Каталог змінюється раз на синхронізацію, не раз на натискання клавіші. */
const TTL_MS = 5 * 60 * 1000
let cache: { at: number; items: CatalogueItem[] } | null = null

async function catalogue(): Promise<CatalogueItem[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.items

  const service = createServiceClient()

  /*
   * Сторінками, а не одним запитом.
   *
   * PostgREST віддає щонайбільше тисячу рядків і мовчить про це. Товарів
   * у нас дві з половиною тисячі, у Бітріксі — чотири: каталог приїжджав
   * обрізаним на букві «П», і все, що далі за абеткою, в пошуку просто
   * не існувало. «Шия свиняча» є в Бітріксі з ціною 323 ₴ — а оператор
   * бачив порожньо й вписував рядок руками, без ціни, після чого
   * замовлення не давало себе оформити.
   */
  const data = await fetchAllRows<{
    id: string; name: string; sku: string | null; code_1c: string | null
    uid_1c: string | null; price: number | null; stock: number | null
    unit: string | null; status: string; category_name: string | null
    attributes: Record<string, string> | null
    images: string[] | null
  }>(() => service
    .from('products')
    .select('id, name, sku, code_1c, uid_1c, price, stock, unit, status, category_name, attributes, images')
    // Активні першими: по телефону здебільшого замовляють те, що є
    .order('status')
    .order('name'))

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
  const [fromBitrix, lastPrices] = await Promise.all([
    fetchAllRows<{
      product_id: number; uid_1c: string; name: string
      measure: string | null; price: number | null
    }>(() => service.from('bitrix_products')
      .select('product_id, uid_1c, name, measure, price')
      .eq('active', true)
      .order('name')),
    /*
     * Остання ціна продажу — на випадок, коли в каталозі її немає.
     *
     * Онлайнова ціна стоїть не в усіх товарів: те, чого онлайн не
     * продають, її й не має. Тоді беремо ту, за якою товар справді
     * продали востаннє, і кажемо, коли це було.
     */
    fetchAllRows<{ product_id: number; price: number | null; sold_on: string | null }>(
      () => service.from('bitrix_last_price').select('product_id, price, sold_on')),
  ])

  const priced = new Map(
    lastPrices.map(r => [
      Number(r.product_id),
      { price: Number(r.price ?? 0), on: r.sold_on as string | null },
    ]),
  )

  /*
   * Привиди з минулих завантажень відкидаємо.
   *
   * У каталозі лежить 2 445 товарів, і 1 066 з них не мають коду 1С —
   * геть усі такі стоять неактивними. Це сліди попередніх імпортів: той
   * самий товар під тим самим артикулом, але без зв'язку з 1С. У пошуку
   * вони стояли поруч зі справжнім — три «Філе куряче Я0085» підряд, і
   * котре з них живе, знав хіба що той, хто дивився на дату оновлення.
   *
   * А головне — саме такий рядок 1С і не впізнає: кода, за яким його
   * шукати, в ньому немає. Звідси й порожня позиція в замовленні, через
   * яку кур'єр їздив двічі.
   *
   * Товар без коду 1С, але живий, тут не постраждає: таких немає жодного.
   */
  const linked = data.filter(p => (p.uid_1c ?? '').trim() !== '')

  const items = linked.map(p => {
    const attrs = p.attributes ?? {}
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
      image: Array.isArray(p.images) ? p.images[0] ?? null : null,
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
    linked.map(p => bare(p.uid_1c)).filter(Boolean),
  )

  /*
   * Мертву номенклатуру не пропонуємо.
   *
   * У CRM лежить усе, що колись заводили, — чотири тисячі позицій, і
   * ознаки «видалено» там немає: активними стоять геть усі. А в
   * магазинах половини цього вже немає роками, і коли така позиція
   * потрапляє в замовлення, 1С не впізнає її й лишає порожній рядок:
   * комірник бачить ціну без назви, доважує щось навмання, і
   * замовлення їде назад із кур'єром.
   *
   * Ознакою життя беремо онлайнову ціну: її ставлять тому, що товар
   * продають. Плюс те, що справді продавали через нас, — такий товар
   * живий незалежно від того, чи дійшли до нього руки прайсу.
   */
  const inUse = (b: { product_id: number; price: number | null }) =>
    Number(b.price ?? 0) > 0 || (priced.get(Number(b.product_id))?.price ?? 0) > 0

  const extra: CatalogueItem[] = fromBitrix
    .filter(b => !known.has(bare(b.uid_1c)) && inUse(b))
    .map(b => ({
      id: `bx-${b.product_id}`,
      name: b.name as string,
      sku: null,
      code_1c: b.uid_1c as string,
      /*
       * Каталог головніший за історію.
       *
       * Онлайнова ціна — чинна, і саме її почує покупець. Остання ціна
       * продажу лишається запасною: вона каже, скільки це коштувало,
       * коли коштувало востаннє.
       */
      price: Number(b.price ?? 0) || priced.get(Number(b.product_id))?.price || 0,
      price_from: Number(b.price ?? 0) > 0
        ? null
        : priced.get(Number(b.product_id))?.on ?? null,
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

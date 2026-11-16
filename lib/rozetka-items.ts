/**
 * Товари на Rozetka — через API, а не через прайс-лист.
 *
 * Rozetka вміє і те, і те. Прайс-лист вона забирає сама раз на кілька
 * годин, і що в ньому не так — видно лише з її боку; API відповідає
 * одразу й каже, який саме рядок їй не сподобався. Тому картки заводимо
 * і оновлюємо викликами: `items-create/create` на нову,
 * `items-create/mass-update-basic-data` на ціну й залишок.
 *
 * Що Rozetka вимагає, а прайс-лист прощає (з'ясовано на живому
 * кабінеті, бо в документації цього немає):
 *   · `price` і `price_old` — ЦІЛІ числа. 147.3 відкидається з 1005;
 *   · хоча б один `param`. Порожній масив — та сама помилка;
 *   · у кожному оновленні — `name` і `name_ua`, навіть коли міняємо
 *     тільки залишок. Без них 1005 «Необхідно заповнити Name»;
 *   · фото лише https, без кирилиці й пробілів у посиланні.
 *
 * І головне: списку створених карток Rozetka не віддає. `/items/search`
 * показує тільки те, що вже продається. Тому `item_id` кожної картки
 * живе в нас, у `rozetka_items` — загубимо його й наступний прохід
 * заведе дублі.
 */
import { promoFor, oldPriceFor, type Promo } from '@/lib/price-promo'
import { basePrice, roundOffer, categoryFor, type PricingContext } from '@/lib/price-category'
import { calcMarketplacePrice, minWeightLabel, offerStock } from '@/lib/feed-xml'
import { descriptionFor, attrsFor } from '@/lib/product-content'

/** Rozetka відмовляє посиланням із кирилицею, пробілами й плюсом. */
export const usablePicture = (url: string) =>
  /^https:\/\//i.test(url) && !/[Ѐ-ӿ\s+]/.test(url)

/**
 * Вага однієї пропозиції в кілограмах.
 *
 * Це не вага товару в каталозі, а вага тієї порції, яку купують: для
 * вагового це «Мін» (за замовчуванням 400 г, як і в назві), для
 * штучного — «Вага шт». Rozetka вимагає її як обов'язкову
 * характеристику й перевіряє межі категорії, тож число має бути чесне.
 */
export function offerWeightKg(attrs: Record<string, string> | null): number | null {
  const unit = (attrs?.['Одиниця'] ?? '').toLowerCase()
  const min = parseFloat(attrs?.['Мін'] ?? '0') || 0
  const piece = parseFloat(attrs?.['Вага шт'] ?? '0') || 0

  if (unit === 'кг' || unit === 'л') return min > 0 ? min : 0.4
  if (unit === 'г' || unit === 'мл') return (min > 0 ? min : 400) / 1000
  if (piece > 0) return piece

  /*
   * Штучний товар ваги в полях не носить, але носить її в назві:
   * «Кетчуп …, 250 г». Синхронізація з сайту вже дістала це число в
   * атрибут «Вага», лишається перевести в кілограми. Без нього Rozetka
   * не прийме картку взагалі — а таких товарів у нас кожен четвертий.
   */
  const label = (attrs?.['Вага'] ?? '').replace(',', '.').trim()
  const m = /^([\d.]+)\s*(кг|г|л|мл)\.?$/i.exec(label)
  if (m) {
    const n = parseFloat(m[1])
    const unitLabel = m[2].toLowerCase()
    if (n > 0) return unitLabel === 'кг' || unitLabel === 'л' ? n : n / 1000
  }
  return null
}

/**
 * Ціна Rozetka приймає цілою, тож останній крок — округлення вгору.
 *
 * Донизу не можна: ціна з категорії «Маркетплейс» — це вже порахована
 * націнка, і копійка вниз щоразу віднімала б її частину.
 */
export const wholeHryvnia = (price: number) => Math.ceil(Math.round(price * 100) / 100)

export interface RzAttribute {
  id: number
  title: string
  type: string
  values: { id: number; value: string }[]
}

export interface RozetkaItemContext {
  /** наша категорія → id категорії Rozetka */
  categoryIds: Record<string, string>
  /** бренд → id виробника в довіднику Rozetka */
  producerIds: Record<string, number>
  /** id категорії Rozetka → її характеристики з допустимими значеннями */
  categoryAttrs: Record<string, RzAttribute[]>
  pricing: PricingContext
  promos: Promo[]
}

export interface RozetkaItemDraft {
  productId: string
  offerId: string
  categoryId: number
  name: string
  price: number
  priceOld: number | null
  stock: number
  available: boolean
  pictures: string[]
  description: string
  article: string | null
  producer: { id: number; title: string } | null
  weightKg: number | null
  /** Характеристики цієї категорії — з них збираються params */
  attributes: RzAttribute[]
  /** Що ми знаємо про товар, іменами наших полів */
  facts: Record<string, string>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Product = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FeedProduct = any

/**
 * Картка для одного товару — або причина, чому її не буде.
 *
 * Причину повертаємо текстом замість того, щоб мовчки пропустити: саме
 * з таких пропусків складається різниця між «422 товари на МауДау» і
 * «на Rozetka чомусь 380».
 */
export function buildItem(
  fp: FeedProduct, ctx: RozetkaItemContext,
): { item: RozetkaItemDraft } | { error: string; name: string } {
  const p: Product = fp.product
  const attrs = attrsFor(p)
  const label = String(fp.custom_name ?? p.name ?? p.id)

  const offerId = String(p.external_id ?? '').trim()
  if (!/^[A-Za-z0-9]+$/.test(offerId)) {
    return { error: 'немає сталого коду товару', name: label }
  }

  const catId = Number(ctx.categoryIds[p.category_name ?? ''] ?? 0)
  if (!catId) {
    return { error: `категорію «${p.category_name ?? '—'}» не зіставлено з Rozetka`, name: label }
  }

  const weightLabel = minWeightLabel(attrs)
  const baseName = String(fp.custom_name ?? p.name ?? '').trim()
  const name = (weightLabel ? `${baseName}, ${weightLabel}` : baseName).slice(0, 255)
  if (!name) return { error: 'немає назви', name: label }

  const { price: base } = basePrice(p, fp, ctx.pricing)
  const offer = fp.custom_price
    ? base
    : (calcMarketplacePrice(base, attrs) ?? base)
  const priced = roundOffer(offer, categoryFor(fp, ctx.pricing))
  const price = wholeHryvnia(priced)
  if (!(price > 0)) return { error: 'немає ціни', name }

  /* Стара ціна — справжня знижка або намальована, та, що вища. Вона теж
     ціле число, і мусить лишитись вищою за чинну після округлення */
  const realOld = p.price_old && Number(p.price_old) > Number(p.price)
    ? (calcMarketplacePrice(Number(p.price_old), attrs) ?? Number(p.price_old))
    : null
  const oldRaw = oldPriceFor(priced, realOld, promoFor(ctx.promos ?? [], p))
  const priceOld = oldRaw ? Math.max(wholeHryvnia(oldRaw), price + 1) : null

  const pictures = ((p.images as string[]) ?? []).filter(usablePicture).slice(0, 15)
  if (!pictures.length) {
    return { error: 'немає фото за вимогами Rozetka (https, без кирилиці)', name }
  }

  const raw = Number(fp.custom_stock ?? p.stock ?? 0)
  const { available, quantity } = offerStock(p.status, raw)

  const brand = String(p.brand ?? '').trim()
  const producerId = ctx.producerIds[brand]
  /* Вага, яку ми проставили самі, важить більше: саме її й проставляли
     там, де на сайті ваги немає ніде */
  const weightKg = Number(p.weight_own) > 0 ? Number(p.weight_own) : offerWeightKg(attrs)

  return {
    item: {
      productId: p.id as string,
      offerId,
      categoryId: catId,
      name,
      price,
      priceOld,
      stock: Math.max(0, Math.ceil(quantity ?? 0)),
      available,
      pictures,
      description: descriptionFor(p).slice(0, 50_000),
      article: (p.sku as string) || null,
      /*
       * Виробника ставимо завжди, коли бренд відомий.
       *
       * Довідник Rozetka знає не всі наші бренди — «Don Gastronom»,
       * «Наминака» і ще п'ятнадцять у ньому просто відсутні. Нуль із
       * назвою Rozetka приймає, і картка виходить із виробником, а не
       * порожнім полем.
       */
      producer: brand ? { id: producerId ?? 0, title: brand } : null,
      weightKg,
      attributes: ctx.categoryAttrs[String(catId)] ?? [],
      facts: attrs,
    },
  }
}

/**
 * Усе, що Rozetka приймає і на створення, і на оновлення.
 *
 * Оновлення тут не обмежене ціною й залишком навмисно: опис, фото,
 * виробник і характеристики так само приїжджають кожним проходом. Інакше
 * картка, заведена порожньою, лишилась би порожньою назавжди — а саме
 * такими й були перші чотириста, поки описи дописувались.
 *
 * `name` і `name_ua` обов'язкові навіть тоді, коли змінюється сам лише
 * залишок: без них Rozetka відповідає 1005.
 */
export function basicFields(item: RozetkaItemDraft) {
  return {
    name: item.name,
    name_ua: item.name,
    price: item.price,
    ...(item.priceOld ? { price_old: item.priceOld } : {}),
    stock_quantity: item.stock,
    available: item.available,
    price_offer_id: item.offerId,
    ...(item.article ? { article: item.article } : {}),
    ...(item.description ? { description: item.description, description_ua: item.description } : {}),
    ...(item.pictures.length ? { pictures: item.pictures.map(link => ({ link })) } : {}),
    ...(item.producer ? { producer: item.producer } : {}),
  }
}

/**
 * Наші поля → характеристики Rozetka.
 *
 * Зліва те, як поле зветься в нас, справа — як його шукати в категорії.
 * Назви характеристик Rozetka тримає свої й у кожній категорії трохи
 * інші, тому шукаємо за зразком, а не за точним рядком.
 */
const FIELD_TO_ATTR: [string, RegExp][] = [
  ['Країна', /^країна[- ]виробник/i],
  ['Склад', /^склад$/i],
  ['Умови зберігання', /^умови зберігання/i],
  ['Термін зберігання', /^термін зберігання/i],
  ['Упаковка', /^упаковка$/i],
]

/** Типи, де Rozetka приймає лише id зі свого списку значень. */
const LIST_TYPES = /^(List|ListValues|ComboBox|CheckBoxGroup|CheckBoxGroupValues)/

/**
 * Характеристики картки. Порожнім масивом Rozetka не вдовольняється,
 * тож вага тут обов'язкова — решта додається, коли є що додати.
 *
 * Значення зі списку мусить збігтися з довідником Rozetka: вигадане
 * «Україна» в категорії, де воно зветься інакше, картка проковтне
 * мовчки, а характеристика лишиться порожньою.
 */
export function itemParams(item: RozetkaItemDraft) {
  const byPattern = (re: RegExp) => item.attributes.find(a => re.test(a.title ?? ''))
  const params: { id: number; title: string; type: string; value: unknown }[] = []

  const weightAttr = byPattern(/^вага в упаковці$/i)
  if (!weightAttr || !item.weightKg) return []
  params.push({
    id: weightAttr.id, title: weightAttr.title, type: weightAttr.type,
    value: Math.round(item.weightKg * 1000) / 1000,
  })

  for (const [field, pattern] of FIELD_TO_ATTR) {
    const raw = (item.facts[field] ?? '').trim()
    if (!raw) continue
    const attr = byPattern(pattern)
    if (!attr) continue

    if (LIST_TYPES.test(attr.type)) {
      const match = attr.values.find(v => v.value.trim().toLowerCase() === raw.toLowerCase())
      if (!match) continue
      params.push({ id: attr.id, title: attr.title, type: attr.type, value: [{ id: match.id, value: match.value }] })
    } else {
      params.push({ id: attr.id, title: attr.title, type: attr.type, value: raw })
    }
  }

  return params
}

/**
 * Відбиток картки — усе, що ми віддаємо Rozetka, одним рядком.
 *
 * Порівнювати ціну з ціною легко, а опис з описом і десяток
 * характеристик — ні, поки не тримаєш їхньої копії в себе. Відбиток
 * дешевший за копію й відповідає на єдине потрібне питання.
 */
export function contentHash(item: RozetkaItemDraft, params: unknown[]): string {
  const parts = [
    item.name, item.price, item.priceOld ?? '', item.stock, item.available ? 1 : 0,
    item.description, item.pictures.join('|'),
    item.producer ? `${item.producer.id}:${item.producer.title}` : '',
    JSON.stringify(params),
  ].join('\u0001')

  /* FNV-1a: нам потрібне не криптостійке, а коротке й стабільне число */
  let hash = 0x811c9dc5
  for (let i = 0; i < parts.length; i++) {
    hash ^= parts.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36)
}

/**
 * Чи змінилось те, заради чого варто турбувати Rozetka.
 *
 * Прохід іде щогодини по чотирьох сотнях карток. Слати всі щоразу — це
 * і квота, і ризик зачепити модерацію там, де нічого не змінилось.
 */
export function needsUpdate(
  item: RozetkaItemDraft,
  params: unknown[],
  sent: { content_hash?: string | null } | null,
): boolean {
  if (!sent?.content_hash) return true
  return sent.content_hash !== contentHash(item, params)
}

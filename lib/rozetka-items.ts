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

export interface RozetkaItemContext {
  /** наша категорія → id категорії Rozetka */
  categoryIds: Record<string, string>
  /** бренд → id виробника в довіднику Rozetka */
  producerIds: Record<string, number>
  /** id категорії Rozetka → id характеристики «Вага в упаковці» */
  weightAttr: Record<string, number>
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
  weightAttrId: number | null
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
  const attrs = (p.attributes as Record<string, string>) ?? {}
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
  const weightKg = offerWeightKg(attrs)
  const weightAttrId = ctx.weightAttr[String(catId)] ?? null

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
      description: String(p.description ?? '').slice(0, 50_000),
      article: (p.sku as string) || null,
      producer: producerId ? { id: producerId, title: brand } : null,
      weightKg,
      weightAttrId,
    },
  }
}

/** Поля, які Rozetka приймає і на створення, і на оновлення. */
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
  }
}

/** Характеристики. Порожнім масивом Rozetka не вдовольняється. */
export function itemParams(item: RozetkaItemDraft) {
  if (!item.weightAttrId || !item.weightKg) return []
  return [{
    id: item.weightAttrId,
    title: 'Вага в упаковці',
    type: 'Decimal',
    value: Math.round(item.weightKg * 1000) / 1000,
  }]
}

/**
 * Чи змінилось те, заради чого варто турбувати Rozetka.
 *
 * Прохід іде щогодини по чотирьох сотнях карток. Слати всі щоразу — це
 * і квота, і ризик зачепити модерацію там, де нічого не змінилось.
 */
export function needsUpdate(
  item: RozetkaItemDraft,
  sent: { price?: number | null; price_old?: number | null; stock?: number | null; available?: boolean | null } | null,
): boolean {
  if (!sent) return true
  return Number(sent.price) !== item.price
    || Number(sent.price_old ?? 0) !== Number(item.priceOld ?? 0)
    || Number(sent.stock) !== item.stock
    || Boolean(sent.available) !== item.available
}

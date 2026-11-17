import { describe, it, expect } from 'vitest'
import {
  offerWeightKg, wholeHryvnia, usablePicture, needsUpdate, itemParams, buildItem, contentHash,
  type RozetkaItemContext, type RozetkaItemDraft,
} from '@/lib/rozetka-items'
import type { PricingContext, PriceCategory } from '@/lib/price-category'

const marketplace = {
  id: 'cat-1', name: 'Маркетплейс', source: 'site', bitrix_price_type_id: null,
  multiplier: 1.18, is_system: false, rounding: 'up', rounding_step: 0.1,
} as PriceCategory

const pricing: PricingContext = {
  feedCategory: marketplace,
  byId: new Map([['cat-1', marketplace]]),
  bitrixPrices: new Map(),
}

const ctx: RozetkaItemContext = {
  categoryIds: { 'Шашлики': '4632859' },
  producerIds: { 'Галицька Свіжина': 822418 },
  categoryAttrs: {
    '4632859': [
      { id: 48739, title: 'Вага в упаковці', type: 'Decimal', values: [] },
      { id: 98900, title: 'Країна-виробник', type: 'ListValues',
        values: [{ id: 1, value: 'Україна' }, { id: 2, value: 'Польща' }] },
      { id: 137119, title: 'Умови зберігання', type: 'TextArea', values: [] },
    ],
  },
  pricing,
  promos: [{
    id: 'p1', feed_id: 'f1', scope: 'all', category_name: null, product_id: null,
    mode: 'percent', value: 25,
  }],
}

const product = (over: Record<string, unknown> = {}) => ({
  id: 'prod-1', external_id: '725069', name: 'Шашлик "Козацький"', sku: '155',
  price: 312, price_old: null, stock: 3, status: 'active', brand: 'Галицька Свіжина',
  category_name: 'Шашлики', description: 'Склад: лопатка свиняча.',
  images: ['https://halytska-svizhyna.ua/wp-content/uploads/2025/07/shashlyk.png'],
  attributes: { 'Одиниця': 'кг', 'Мін': '0.4', 'Крок': '0.2' },
  ...over,
})

const line = (p: Record<string, unknown>) => ({ product: p, is_active: true })

describe('ціна для Rozetka', () => {
  it('категорія, фасовка і ціле число — у такому порядку', () => {
    /* 312 за кілограм → 0,4 кг коштують 124,80 → ×1,18 = 147,26 →
       147,30 за правилом категорії → 148 ₴, бо Rozetka дробових не бере */
    const built = buildItem(line(product()), ctx)
    expect('item' in built && built.item.price).toBe(148)
  })

  it('округлюємо вгору: копійка вниз — це відкушена націнка', () => {
    expect(wholeHryvnia(147.01)).toBe(148)
    expect(wholeHryvnia(147)).toBe(147)
  })

  it('штучна знижка малює стару ціну, не чіпаючи чинної', () => {
    const built = buildItem(line(product()), ctx)
    if (!('item' in built)) throw new Error(built.error)
    expect(built.item.price).toBe(148)
    expect(built.item.priceOld).toBe(185)
  })

  it('стара ціна ніколи не дорівнює чинній після округлення', () => {
    /* Дешевий товар: 10 ₴ з націнкою 25 % після заокруглення вгору дав би
       те саме число, і Rozetka показала б перекреслену ціну, рівну ціні */
    const cheap = buildItem(line(product({ price: 2, attributes: { 'Одиниця': 'шт', 'Вага шт': '0.1' } })), ctx)
    if (!('item' in cheap)) throw new Error(cheap.error)
    expect(cheap.item.priceOld).toBeGreaterThan(cheap.item.price)
  })
})

describe('вага порції', () => {
  it('ваговий товар міряємо його «Мін»', () => {
    expect(offerWeightKg({ 'Одиниця': 'кг', 'Мін': '0.4' })).toBe(0.4)
  })

  it('без «Мін» — ті самі 400 г, що й у назві', () => {
    expect(offerWeightKg({ 'Одиниця': 'кг' })).toBe(0.4)
  })

  it('штучний товар носить вагу в назві, і її вже дістали в атрибут', () => {
    /* Кетчуп, 250 г: ні «Мін», ні «Вага шт» — лише рядок із назви.
       Без цього розбору чверть каталогу лишалась без обов'язкової
       характеристики, а отже й без картки */
    expect(offerWeightKg({ 'Одиниця': 'шт', 'Вага': '250 г' })).toBe(0.25)
    expect(offerWeightKg({ 'Одиниця': 'шт', 'Вага': '314 мл' })).toBe(0.314)
    expect(offerWeightKg({ 'Одиниця': 'шт', 'Вага': '1,2 кг' })).toBe(1.2)
  })

  it('коли ваги немає ніде — мовчимо, а не вигадуємо', () => {
    /* Вигадане число поїде в розрахунок доставки Rozetka */
    expect(offerWeightKg({ 'Одиниця': 'шт' })).toBeNull()
    expect(offerWeightKg(null)).toBeNull()
  })

  it('без ваги характеристик немає, а без них Rozetka картку не бере', () => {
    const draft = {
      weightKg: null, facts: {},
      attributes: [{ id: 48739, title: 'Вага в упаковці', type: 'Decimal', values: [] }],
    } as unknown as RozetkaItemDraft
    expect(itemParams(draft)).toEqual([])
  })
})

describe('що не поїде на Rozetka', () => {
  it('категорія без зіставлення — причина, а не тиша', () => {
    const built = buildItem(line(product({ category_name: 'Товари для дому' })), ctx)
    expect('error' in built && built.error).toMatch(/не зіставлено/)
  })

  it('фото з кирилицею Rozetka відхиляє, тож не відправляємо', () => {
    expect(usablePicture('https://site.ua/шашлик.jpg')).toBe(false)
    expect(usablePicture('http://site.ua/a.jpg')).toBe(false)
    expect(usablePicture('https://site.ua/a.jpg')).toBe(true)
    const built = buildItem(line(product({ images: ['https://site.ua/шашлик.jpg'] })), ctx)
    expect('error' in built && built.error).toMatch(/фото/)
  })

  it('знятий з сайту товар лишається карткою, але без залишку', () => {
    /* Зникла картка — це втрачені відгуки й позиція в пошуку */
    const built = buildItem(line(product({ status: 'archived' })), ctx)
    if (!('item' in built)) throw new Error(built.error)
    expect(built.item.available).toBe(false)
    expect(built.item.stock).toBe(0)
  })
})

describe('кого турбуємо наступним проходом', () => {
  const draft = buildItem(line(product()), ctx)
  if (!('item' in draft)) throw new Error('не зібралось')
  const params = itemParams(draft.item)
  const hash = contentHash(draft.item, params)

  it('нічого не змінилось — не турбуємо', () => {
    expect(needsUpdate(draft.item, params, { content_hash: hash })).toBe(false)
  })

  it('змінився опис — турбуємо, хоч ціна та сама', () => {
    /* Поки звіряли лише ціну й залишок, дописані описи не доїжджали:
       картка лишалась порожньою, бо гроші в ній не рухались */
    const edited = buildItem(line(product({ description_own: 'новий опис' })), ctx)
    if (!('item' in edited)) throw new Error('не зібралось')
    expect(needsUpdate(edited.item, itemParams(edited.item), { content_hash: hash })).toBe(true)
  })

  it('змінився залишок — турбуємо', () => {
    const moved = buildItem(line(product({ stock: 0 })), ctx)
    if (!('item' in moved)) throw new Error('не зібралось')
    expect(needsUpdate(moved.item, itemParams(moved.item), { content_hash: hash })).toBe(true)
  })

  it('картка, якої ми ще не бачили, — завжди', () => {
    expect(needsUpdate(draft.item, params, null)).toBe(true)
    expect(needsUpdate(draft.item, params, { content_hash: null })).toBe(true)
  })
})

describe('характеристики картки', () => {
  const facts = (over: Record<string, string> = {}) => ({
    'Одиниця': 'кг', 'Мін': '0.4', 'Країна': 'Україна',
    'Умови зберігання': 'Зберігати за температури від 0 до +4 °C', ...over,
  })

  it('вага йде завжди, решта — коли є що сказати', () => {
    const built = buildItem(line(product({ attrs_own: facts() })), ctx)
    if (!('item' in built)) throw new Error(built.error)
    const params = itemParams(built.item)
    expect(params.map(p => p.title)).toEqual([
      'Вага в упаковці', 'Країна-виробник', 'Умови зберігання',
    ])
  })

  it('значення зі списку йде з номером, бо текст Rozetka мовчки ковтає', () => {
    const built = buildItem(line(product({ attrs_own: facts() })), ctx)
    if (!('item' in built)) throw new Error(built.error)
    const country = itemParams(built.item).find(p => p.title === 'Країна-виробник')
    expect(country?.value).toEqual([{ id: 1, value: 'Україна' }])
  })

  it('значення, якого немає в довіднику категорії, не вигадуємо', () => {
    const built = buildItem(line(product({ attrs_own: facts({ 'Країна': 'Молдова' }) })), ctx)
    if (!('item' in built)) throw new Error(built.error)
    expect(itemParams(built.item).some(p => p.title === 'Країна-виробник')).toBe(false)
  })
})

describe('виробник', () => {
  it('знайдений бренд іде своїм номером', () => {
    const built = buildItem(line(product()), ctx)
    expect('item' in built && built.item.producer).toEqual({ id: 822418, title: 'Галицька Свіжина' })
  })

  it('бренду немає в довіднику Rozetka — йде нулем, але з назвою', () => {
    /* Сімнадцяти наших брендів у їхньому довіднику просто немає, а
       порожнє поле виробника гірше за назву без номера */
    const built = buildItem(line(product({ brand: 'Наминака' })), ctx)
    expect('item' in built && built.item.producer).toEqual({ id: 0, title: 'Наминака' })
  })
})

describe('наш опис головніший за сайтів', () => {
  it('написане нами перемагає', () => {
    const built = buildItem(line(product({ description: 'з сайту', description_own: 'наше' })), ctx)
    expect('item' in built && built.item.description).toBe('наше')
  })

  it('коли свого немає — беремо те, що з сайту', () => {
    const built = buildItem(line(product({ description: 'з сайту' })), ctx)
    expect('item' in built && built.item.description).toBe('з сайту')
  })
})

describe('назва без скорочень', () => {
  /* Сім карток Rozetka відхилила з єдиним коментарем модератора —
     «скорочення в назві». Розкрите лежить у name_own, і саме воно
     мусить доїхати до картки; name із сайту лишається «в/г». */
  it('name_own головніша за назву з сайту', () => {
    const built = buildItem(line(product({
      name: 'Ковбаса "Львівська" в/г, упак',
      name_own: 'Ковбаса "Львівська" вищого ґатунку, в упаковці',
    })), ctx)
    if (!('item' in built)) throw new Error(built.error)
    expect(built.item.name).toBe('Ковбаса "Львівська" вищого ґатунку, в упаковці, 400 г')
  })

  it('без name_own лишається назва з сайту', () => {
    const built = buildItem(line(product({ name: 'Шашлик "Козацький"' })), ctx)
    if (!('item' in built)) throw new Error(built.error)
    expect(built.item.name).toBe('Шашлик "Козацький", 400 г')
  })

  it('порожня name_own не затирає назви', () => {
    const built = buildItem(line(product({ name: 'Шашлик "Козацький"', name_own: '   ' })), ctx)
    if (!('item' in built)) throw new Error(built.error)
    expect(built.item.name).toBe('Шашлик "Козацький", 400 г')
  })

  it('назва в фіді важить більше за обидві', () => {
    const built = buildItem(
      { ...line(product({ name_own: 'Розкрита' })), custom_name: 'Назва з фіда' }, ctx,
    )
    if (!('item' in built)) throw new Error(built.error)
    expect(built.item.name).toBe('Назва з фіда, 400 г')
  })

  it('нова назва змінює відбиток — інакше Rozetka її не побачить', () => {
    const was = buildItem(line(product({ name: 'Ковбаса в/г' })), ctx)
    const now = buildItem(line(product({ name: 'Ковбаса в/г', name_own: 'Ковбаса вищого ґатунку' })), ctx)
    if (!('item' in was) || !('item' in now)) throw new Error('не збудувалось')
    const hash = (i: RozetkaItemDraft) => contentHash(i, itemParams(i))
    expect(hash(now.item)).not.toBe(hash(was.item))
    expect(needsUpdate(now.item, itemParams(now.item), { content_hash: hash(was.item) })).toBe(true)
  })
})

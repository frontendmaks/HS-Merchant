import { describe, it, expect } from 'vitest'
import {
  offerWeightKg, wholeHryvnia, usablePicture, needsUpdate, itemParams, buildItem,
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
  weightAttr: { '4632859': 48739 },
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
    const draft = { weightAttrId: 48739, weightKg: null } as RozetkaItemDraft
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
  const draft = { price: 148, priceOld: 185, stock: 3, available: true } as RozetkaItemDraft

  it('нічого не змінилось — не турбуємо', () => {
    expect(needsUpdate(draft, { price: 148, price_old: 185, stock: 3, available: true })).toBe(false)
  })

  it('змінився залишок — турбуємо', () => {
    expect(needsUpdate(draft, { price: 148, price_old: 185, stock: 0, available: false })).toBe(true)
  })

  it('картка, якої ми ще не бачили, — завжди', () => {
    expect(needsUpdate(draft, null)).toBe(true)
  })
})

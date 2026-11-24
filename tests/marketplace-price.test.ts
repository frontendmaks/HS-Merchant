import { describe, it, expect } from 'vitest'
import { underpriced, isServiceItem, type DealRow } from '@/lib/marketplace-price-check'

/*
 * М16 за 16 листопада. Вісім рядків пішли з націнкою, дев'ятий —
 * шашлик — повернувся з 1С за ціною картки, 345 замість 407,10, бо
 * номенклатуру в ньому замінили. Побачив це Тарас, не ми.
 */
const row = (name: string, price: number): DealRow =>
  ({ PRODUCT_ID: 1, PRODUCT_NAME: name, PRICE: price, QUANTITY: 1 })

describe('втрачена націнка в маркетплейсній угоді', () => {
  const want: Record<string, number> = {
    'Шашлик з філе стегна 1 кг, упак': 407.1,
    'Стейк Рібай яловичий охол в/у': 1400.7,
    'Термобокс 270*500*300': 294.5,
  }
  const expected = (r: DealRow) => want[r.PRODUCT_NAME] ?? null

  it('ціна картки 1С замість категорійної — це знахідка', () => {
    const hit = underpriced([row('Шашлик з філе стегна 1 кг, упак', 345)], expected)
    expect(hit).toHaveLength(1)
  })

  it('правильний рядок мовчить', () => {
    expect(underpriced([row('Стейк Рібай яловичий охол в/у', 1400.7)], expected)).toHaveLength(0)
  })

  it('копійка через заокруглення не рахується', () => {
    /* 1400.7 проти 1400.69 — це хвіст коефіцієнта, а не втрачені гроші */
    expect(underpriced([row('Стейк Рібай яловичий охол в/у', 1400.69)], expected)).toHaveLength(0)
  })

  it('дорожче за очікуване — теж не біда', () => {
    expect(underpriced([row('Стейк Рібай яловичий охол в/у', 1500)], expected)).toHaveLength(0)
  })

  it('тару не чіпаємо: її дописує комірник, і ціна в неї своя', () => {
    /* Перша версія рахувала термопакет за втрату й світила червоним у
       кожній другій угоді — а перевірка, яка кричить щодня, перестає
       щось значити */
    expect(underpriced([row('Термобокс 270*500*300', 250)], expected)).toHaveLength(0)
    expect(isServiceItem('Термопакет ')).toBe(true)
    expect(isServiceItem('Кульки фірмові Малі 100шт')).toBe(true)
    expect(isServiceItem('Стейк Рібай яловичий охол в/у')).toBe(false)
  })

  it('без базової ціни рядок мовчить, а не звинувачує', () => {
    expect(underpriced([row('Голови курячі', 10)], expected)).toHaveLength(0)
  })
})

/*
 * Фасування для маркетплейсу.
 *
 * Рулет курячий зі шпинатом на сайті продається від 600 г, і саме це
 * число МауДау писав у назву й множив на ціну кілограма. Тарас попросив
 * 500 — але на самому сайті мінімальна порція має лишитись як була, тож
 * виняток живе в рядку фіда.
 */
import { offerAttrs, minWeightLabel, calcMarketplacePrice } from '@/lib/feed-xml'

describe('фасування для окремого маркетплейсу', () => {
  const product = { 'Мін': '0.6', 'Крок': '0.6', 'Одиниця': 'кг' }

  it('без винятку все лишається як у товарі', () => {
    expect(offerAttrs(product, null)).toEqual(product)
    expect(offerAttrs(product, { Вид: 'Батон' })).toEqual(product)
  })

  it('виняток у фіді перебиває фасування товару', () => {
    const attrs = offerAttrs(product, { 'Мін': '0.5', 'Крок': '0.5' })
    expect(attrs['Мін']).toBe('0.5')
    expect(minWeightLabel(attrs)).toBe('500 г')
    expect(calcMarketplacePrice(431, attrs)).toBe(215.5)
  })

  it('товар без фасування отримує його з фіда', () => {
    const attrs = offerAttrs({ 'Одиниця': 'кг' }, { 'Мін': '0.5' })
    expect(minWeightLabel(attrs)).toBe('500 г')
    expect(calcMarketplacePrice(399, attrs)).toBe(199.5)
  })

  /* Характеристики маркетплейсу — не фасування: «Вага» на картці МауДау
     це текст для покупця, а не число, на яке множиться ціна */
  it('характеристики маркетплейсу фасування не чіпають', () => {
    const attrs = offerAttrs(product, { 'Вага': '400 г', 'Вага упаковки': '0.6 кг' })
    expect(attrs['Мін']).toBe('0.6')
    expect(attrs['Вага']).toBeUndefined()
  })

  it('порожній виняток не стирає того, що є', () => {
    expect(offerAttrs(product, { 'Мін': '', 'Крок': '   ' })['Мін']).toBe('0.6')
  })
})

/*
 * Друга половина правила: «дешевше за належне» ще не означає «втратили
 * націнку». Ціна в угоді застигла такою, якою була в день замовлення,
 * а наша базова живе далі.
 */
describe('стара ціна — не втрачена націнка', () => {
  const base: Record<string, number> = {
    'Тарталетки 100г ТМ Дом. прод.(18)': 56,
    'Рулет курячий з ШПИНАТОМ печений': 431,
  }
  const baseOf = (r: DealRow) => base[r.PRODUCT_NAME] ?? null
  const expected = (r: DealRow) => {
    const b = baseOf(r)
    return b == null ? null : Math.round(Math.ceil(b * 1.18 / 0.1) * 0.1 * 100) / 100
  }

  it('рядок за старою ціною мовчить', () => {
    /* 58,50 — це 49,58 × 1,18: покупець заплатив рівно стільки, скільки бачив */
    const hit = underpriced([row('Тарталетки 100г ТМ Дом. прод.(18)', 58.5)], expected, baseOf)
    expect(hit).toHaveLength(0)
  })

  it('гола ціна картки 1С — знахідка', () => {
    const hit = underpriced([row('Рулет курячий з ШПИНАТОМ печений', 431)], expected, baseOf)
    expect(hit).toHaveLength(1)
  })

  it('копійчана різниця з базою — та сама гола ціна', () => {
    const hit = underpriced([row('Рулет курячий з ШПИНАТОМ печений', 430.99)], expected, baseOf)
    expect(hit).toHaveLength(1)
  })

  it('без базової ціни лишається старе правило', () => {
    const hit = underpriced([row('Рулет курячий з ШПИНАТОМ печений', 431)], expected, () => null)
    expect(hit).toHaveLength(1)
  })
})

describe('допуск до базової ціни — копійки, не відсотки', () => {
  const base: Record<string, number> = { 'Рулет по-галицьки варений': 329 }
  const baseOf = (r: DealRow) => base[r.PRODUCT_NAME] ?? null
  const expected = (r: DealRow) => {
    const b = baseOf(r)
    return b == null ? null : Math.round(Math.ceil(b * 1.18 / 0.1) * 0.1 * 100) / 100
  }

  it('329,30 при базі 329 — стара ціна, не гола картка', () => {
    /* 279,07 × 1,18 = 329,30: націнка була, просто база відтоді зросла */
    expect(underpriced([row('Рулет по-галицьки варений', 329.3)], expected, baseOf))
      .toHaveLength(0)
  })

  it('329 при базі 329 — гола картка', () => {
    expect(underpriced([row('Рулет по-галицьки варений', 329)], expected, baseOf))
      .toHaveLength(1)
  })
})

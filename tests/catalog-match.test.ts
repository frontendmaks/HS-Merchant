import { describe, it, expect } from 'vitest'
import { marketplaceLines } from '@/lib/order-lines'
import {
  bareName, specFromAttr, unitFromRow, needsOwnQuery,
} from '@/lib/catalog-match'

/**
 * Кожен тест тут названий своєю бідою, а не функцією.
 *
 * «unitOf works» за рік прочитають як забаганку й викинуть. «„Мін“ — це
 * не вага штуки» нагадує, що сталось: замовлення поїхало з 1.6 кг
 * сардельок там, де клієнтка просила чотири штуки.
 */

describe('назва позиції з угоди', () => {
  it('губить хвіст складу — у каталозі товар один на всі точки', () => {
    expect(bareName('Філе куряче - АС 2 онлайн')).toBe('Філе куряче')
    expect(bareName('Полядвиця свиняча - Гуртівня онлайн')).toBe('Полядвиця свиняча')
    expect(bareName('Четвертина куряча - МЕ Панська Гора Онлайн')).toBe('Четвертина куряча')
  })

  it('не чіпає назву, в якій дефіс — частина самої назви', () => {
    expect(bareName('Корм для тварин "Кіт-Пес"')).toBe('Корм для тварин "Кіт-Пес"')
    expect(bareName('Ковбаса "Куряча" 1/г, упак')).toBe('Ковбаса "Куряча" 1/г, упак')
  })
})

describe('«Мін» — це не вага штуки', () => {
  /*
   * Сардельки продаються від 400 грамів, але важить одна 110. Поки ці
   * два числа плутались, перемикач показував «1 шт = 0.4 кг», і
   * оператор, набираючи «4 шт», клав у замовлення 1.6 кг замість 0.44.
   */
  it('бере вагу штуки з «Вага шт», а не з «Мін»', () => {
    const spec = specFromAttr({ 'Одиниця': 'кг', 'Мін': '0.4', 'Вага шт': '0.11' })
    expect(spec).toEqual({ unit: 'кг', pack: 0.11 })
  })

  it('без ваги штуки перемикача не буде — вигадане число поїхало б у накладну', () => {
    expect(specFromAttr({ 'Одиниця': 'кг', 'Мін': '0.4' })).toEqual({ unit: 'кг', pack: 0 })
  })

  it('штучному товару вага штуки не потрібна', () => {
    expect(specFromAttr({ 'Одиниця': 'шт', 'Вага шт': '0.125' }))
      .toEqual({ unit: 'шт', pack: 0 })
  })

  it('літри рахуємо як вагові — їх теж беруть не штуками', () => {
    expect(specFromAttr({ 'Одиниця': 'л' })?.unit).toBe('кг')
  })

  it('пачки й пляшки — це штуки', () => {
    expect(specFromAttr({ 'Одиниця': 'пч' })?.unit).toBe('шт')
    expect(specFromAttr({ 'Одиниця': 'пляшка' })?.unit).toBe('шт')
  })

  it('без атрибута не вигадує нічого', () => {
    expect(specFromAttr({})).toBeNull()
    expect(specFromAttr(null)).toBeNull()
  })
})

describe('одиниця з рядка угоди — коли каталог товару не знає', () => {
  it('вірить мірі, яку прислав Бітрікс', () => {
    expect(unitFromRow('кг', 20.3)).toBe('кг')
    expect(unitFromRow('Шт', 3)).toBe('шт')
  })

  it('без міри впізнає вагове за дробовою кількістю', () => {
    expect(unitFromRow(null, 8.1)).toBe('кг')
    expect(unitFromRow('', 3)).toBe('шт')
  })
})

describe('назви, які ламають пошук списком', () => {
  /*
   * `.in()` складає значення через кому. Назва з комою всередині в
   * ньому розпадається, товар не знаходиться — і без жодної помилки.
   * Через одну таку назву ціла угода лишилась без артикулів, а 1С
   * показала комірникові порожні поля.
   */
  it('кома в назві — питати окремо', () => {
    expect(needsOwnQuery('Сир кремовий натуральний ТМ "Млековіта", 125 г')).toBe(true)
    expect(needsOwnQuery('Ковбаса "Дрогобицька" в/г, упак')).toBe(true)
  })

  it('лапки без коми теж небезпечні', () => {
    expect(needsOwnQuery('Сир твердий Гауда ТМ "Polmlek"')).toBe(true)
  })

  it('проста назва йде списком', () => {
    expect(needsOwnQuery('Філе куряче')).toBe(false)
    expect(needsOwnQuery('Гомілка куряча')).toBe(false)
  })
})

describe('позиції замовлення з Rozetka', () => {
  /*
   * Rozetka віддає `article` порожнім рядком, а код товару кладе в
   * `price_offer_id`. Доти код брав article першим через `??`, який
   * порожнього рядка не пропускає, — і кожна позиція виходила без коду.
   * Тридцять шість рядків, жодного зіставлення з каталогом: склад
   * отримав би назву й порожню номенклатуру.
   */
  const order = (purchase: Record<string, unknown>) => ({
    platform: 'rozetka',
    raw: { purchases: [{ id: 1, quantity: 2, price_with_discount: '42.00',
      item_name: 'Смалець, 400 г', ...purchase }] },
  })

  it('порожній артикул не затуляє коду товару', () => {
    const [line] = marketplaceLines(order({
      item_id: 572706466,
      item: { article: '', price_offer_id: '125476372' },
    }))
    expect(line.externalId).toBe('125476372')
  })

  it('коли коду немає — лишається артикул', () => {
    const [line] = marketplaceLines(order({
      item_id: 572706466, item: { article: 'ЯД017', price_offer_id: '' },
    }))
    expect(line.externalId).toBe('ЯД017')
  })

  it('останній рубіж — номер картки Rozetka, а не порожнеча', () => {
    const [line] = marketplaceLines(order({ item_id: 572706466, item: {} }))
    expect(line.externalId).toBe('572706466')
  })

  it('ціна й кількість лишаються позиційними', () => {
    const [line] = marketplaceLines(order({
      item_id: 1, item: { price_offer_id: '725069' },
    }))
    expect(line.unitPrice).toBe(42)
    expect(line.quantity).toBe(2)
  })
})

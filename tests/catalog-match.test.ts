import { describe, it, expect } from 'vitest'
import { marketplaceLines } from '@/lib/order-lines'
import { indexCatalog, buildLine } from '@/lib/order-items'
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

describe('від відповіді Rozetka до товару в каталозі', () => {
  /*
   * Увесь шлях одним тестом: те, що Rozetka реально присилає в
   * замовленні, мусить знайти наш товар. Доти не знаходило жодного
   * разу — тридцять шість рядків, нуль зіставлень.
   *
   * Код картки, який ми віддали при заведенні (price_offer_id), — це
   * код товару на сайті. Rozetka повертає його незмінним, тож по ньому
   * товар і знаходиться.
   */
  const catalog = indexCatalog([
    { id: 'prod-1', name: 'Шашлик "Козацький", 400 г', sku: null,
      external_id: '725069', price: 312, attributes: { 'Одиниця': 'кг', 'Мін': '0.4' }, uid_1c: 'guid-1' },
  ] as never)

  const purchase = {
    id: 269550162, item_id: 572706466, quantity: 2,
    price_with_discount: '148.00', item_name: 'Шашлик "Козацький", 400 г',
    item: { article: '', price_offer_id: '725069', uploader_offer_id: '725069' },
  }

  it('позиція знаходить товар за кодом, який ми віддали при заведенні', () => {
    const [line] = marketplaceLines({ platform: 'rozetka', raw: { purchases: [purchase] } })
    const built = buildLine(line, catalog, 0)
    expect(built.product_id).toBe('prod-1')
    expect(built.product_external_id).toBe('725069')
  })

  it('без товару рядок лишився б без коду 1С — саме це й боліло', () => {
    /* Та сама позиція, але код загублено: рядок доходить до складу
       назвою, а номенклатура в 1С лишається порожньою */
    const [line] = marketplaceLines({
      platform: 'rozetka',
      raw: { purchases: [{ ...purchase, item_id: null, item: { article: '' } }] },
    })
    expect(buildLine(line, catalog, 0).product_id).toBeNull()
  })
})

describe('позиції замовлення з Prom', () => {
  /* Prom кладе наш код товару в external_id позиції — той самий, під
     яким товар поїхав у фіді. Без нього рядок не знайде товару, а без
     товару склад отримає назву й порожню номенклатуру. */
  const order = (product: Record<string, unknown>) => ({
    platform: 'prom',
    raw: { products: [{ id: 3088250181, quantity: 6, price: '112',
      name: 'Сало "Snack", 250 г', ...product }] },
  })

  it('код товару беремо з external_id', () => {
    const [line] = marketplaceLines(order({ external_id: '466132' }))
    expect(line.externalId).toBe('466132')
    expect(line.quantity).toBe(6)
    expect(line.unitPrice).toBe(112)
  })

  it('порожній код не затуляє артикула', () => {
    const [line] = marketplaceLines(order({ external_id: '', sku: 'ЯД017' }))
    expect(line.externalId).toBe('ЯД017')
  })

  it('без коду лишається номер картки Prom', () => {
    const [line] = marketplaceLines(order({ external_id: '' }))
    expect(line.externalId).toBe('3088250181')
  })

  it('ціна рядком із пробілами читається числом', () => {
    /* Prom віддає суми як «1 589 грн» — Number() на такому дає NaN,
       і рядок поїхав би в угоду з нульовою ціною */
    const [line] = marketplaceLines(order({ external_id: '1', price: '1 589 грн' }))
    expect(line.unitPrice).toBe(1589)
  })
})

import { describe, it, expect } from 'vitest'
import { measureFor } from '@/lib/bitrix-deal'
import { BITRIX_STAGES, stageId, stageName, CLOSED_STAGES } from '@/lib/bitrix-stages'
import { foldSku, translitSku } from '@/lib/order-items'

describe('міра позиції для Бітрікса', () => {
  /*
   * Поки ми її не передавали, Бітрікс ставив свою усталену — «Штука».
   * Замовлення №7 за 31 жовтня поїхало з «20.3 шт» філе там, де
   * клієнтка просила 20.3 кг, і кожне наступне збереження вписувало
   * штуки заново: оператор правив, а воно поверталось.
   */
  it('кілограм — це код 166', () => {
    expect(measureFor('кг')).toEqual({ MEASURE_CODE: 166, MEASURE_NAME: 'кг' })
  })

  it('усе інше — штука, код 796', () => {
    expect(measureFor('шт').MEASURE_CODE).toBe(796)
    expect(measureFor('пч').MEASURE_CODE).toBe(796)
    expect(measureFor('пляшка').MEASURE_CODE).toBe(796)
  })

  it('невідоме й порожнє не стає кілограмами випадково', () => {
    expect(measureFor(null).MEASURE_CODE).toBe(796)
    expect(measureFor(undefined).MEASURE_CODE).toBe(796)
    expect(measureFor('').MEASURE_CODE).toBe(796)
  })
})

describe('стадії воронки', () => {
  /*
   * Коди й назви розходяться — воронку зібрали з типових стадій і
   * перейменували, тож «Комплектується» має код рахунку-передоплати.
   * Здогадуватись тут не можна: я вже раз вигадав мапу з голови й
   * «знайшов» дев'ятнадцять неіснуючих розбіжностей.
   */
  it('назва й код сходяться в обидва боки', () => {
    for (const s of BITRIX_STAGES) {
      expect(stageId(s.name)).toBe(s.id)
      expect(stageName(s.id)).toBe(s.name)
    }
  })

  it('комплектація має код рахунку-передоплати, хоч як дивно це читається', () => {
    expect(stageId('Комплектується')).toBe('C1:PREPAYMENT_INVOICE')
    expect(stageName('C1:FINAL_INVOICE')).toBe('Спаковано')
  })

  it('невідоме не вдає, ніби знайшлось', () => {
    expect(stageId('Такої стадії немає')).toBeNull()
    expect(stageName('C1:НЕМАЄ')).toBeNull()
  })

  it('закриті стадії не перетинаються з робочими', () => {
    expect(CLOSED_STAGES).not.toContain('Комплектується')
    expect(CLOSED_STAGES).toContain('Виконано')
  })
})

describe('артикул, записаний чужою абеткою', () => {
  /*
   * Маркетплейс повертає наш артикул латинкою. Схожість накреслення й
   * транслітерація — різні речі: кирилична «С» схожа на латинську «C»,
   * але транслітерується як «S». Усі сто дев'ятнадцять артикулів
   * «Я####» не знаходили свого товару.
   */
  it('схожі літери зводяться докупи', () => {
    expect(foldSku('СВ_075')).toBe(foldSku('CB_075'))
  })

  it('«Я» схожої літери не має — її шлють як Ya', () => {
    expect(translitSku('Я0008')).toBe('YA0008')
  })

  it('двознаки йдуть поперед однолітерних', () => {
    expect(translitSku('Щ1')).toBe('SHCH1')
    expect(translitSku('Ж1')).toBe('ZH1')
  })

  it('порожнє лишається порожнім, а не стає збігом для всього', () => {
    expect(foldSku(null)).toBe('')
    expect(translitSku(undefined)).toBe('')
  })
})

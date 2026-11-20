import { describe, it, expect } from 'vitest'
import { hoursFromCityData, slotFromShopHours } from '@/lib/shop-hours'

/*
 * З 16 листопада Гуртівня возить інакше за решту складів: її «27» — це
 * 14:00 — 18:00, тоді як у шести інших той самий номер означає 14:00 —
 * 17:00. Номер один, вікна різні, і підпис Бітрікса знає лише одне з них.
 */
const cityData = {
  shops: [
    {
      title: 'Гуртівня онлайн',
      shop_delivery_hours: [
        { id: '26', from: '11:00', to: '14:00' },
        { id: '27', from: '14:00', to: '18:00' },
        { id: '345', from: '18:00', to: '20:00' },
      ],
    },
    {
      title: 'Санта онлайн',
      shop_delivery_hours: [
        { id: '27', from: '14:00', to: '17:00' },
        { id: '345', from: '17:00', to: '20:00' },
      ],
    },
    { title: 'Склад-Магазин', shop_delivery_hours: false as const },
  ],
}

describe('години доставки по складах', () => {
  const hours = hoursFromCityData(cityData)

  it('той самий номер у двох складів означає різні вікна', () => {
    expect(slotFromShopHours(hours, 'Гуртівня онлайн', '27')).toBe('14:00-18:00')
    expect(slotFromShopHours(hours, 'Санта онлайн', '27')).toBe('14:00-17:00')
  })

  it('вечірній період Гуртівні починається о вісімнадцятій', () => {
    expect(slotFromShopHours(hours, 'Гуртівня онлайн', '345')).toBe('18:00-20:00')
    expect(slotFromShopHours(hours, 'Санта онлайн', '345')).toBe('17:00-20:00')
  })

  it('склад без годин нічого не підказує — підпис візьме Бітрікс', () => {
    expect(slotFromShopHours(hours, 'Склад-Магазин', '27')).toBeNull()
    expect(slotFromShopHours(hours, 'МЕ ТТ Іскра', '27')).toBeNull()
  })

  it('невідомий номер періоду теж лишається Бітріксу', () => {
    expect(slotFromShopHours(hours, 'Гуртівня онлайн', '449')).toBeNull()
    expect(slotFromShopHours(hours, 'Гуртівня онлайн', '0')).toBeNull()
    expect(slotFromShopHours(hours, 'Гуртівня онлайн', null)).toBeNull()
    expect(slotFromShopHours(hours, null, '27')).toBeNull()
  })

  it('зайві пробіли й регістр у назві складу не розводять його надвоє', () => {
    expect(slotFromShopHours(hours, '  гуртівня   ОНЛАЙН ', '27')).toBe('14:00-18:00')
  })

  it('півперіоду не записуємо — це не вікно', () => {
    const half = hoursFromCityData({
      shops: [{ title: 'Склад', shop_delivery_hours: [{ id: '27', from: '14:00', to: '' }] }],
    })
    expect(slotFromShopHours(half, 'Склад', '27')).toBeNull()
  })

  it('порожня відповідь сайту не дає порожніх підписів', () => {
    expect(hoursFromCityData(null)).toEqual({})
    expect(hoursFromCityData({ shops: [] })).toEqual({})
  })
})

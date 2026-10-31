import { describe, it, expect } from 'vitest'
import {
  isHandedOver, hasWaybill, canEditItems, requiresPayment,
  canCreateWaybill, canRecordPicking, canTogglePaid,
} from '@/lib/order-statuses'
import {
  deliveryFeeFor, DELIVERY_TITLE, DELIVERY_FEE, FREE_DELIVERY_FROM,
} from '@/lib/delivery-fee'
import { holdSheetForNumber } from '@/lib/bitrix-chat'

describe('накладна замикає замовлення', () => {
  it('номер накладної важить більше за статус — статус відстає', () => {
    expect(isHandedOver('Узгоджено', '20450912345678')).toBe(true)
  })

  it('«нема товару» в полі ТТН — це не накладна', () => {
    /* Одне замовлення носить у цьому полі саме такий текст, і він не
       має нічого замикати */
    expect(hasWaybill('нема товару')).toBe(false)
    expect(isHandedOver('Узгоджено', 'нема товару')).toBe(false)
  })

  it('короткий набір цифр теж не накладна', () => {
    expect(hasWaybill('123')).toBe(false)
    expect(hasWaybill('2045 0912 345678')).toBe(true)
  })
})

describe('склад замовлення замикається на «Узгоджено»', () => {
  it('до узгодження позиції правити можна', () => {
    expect(canEditItems('Прийнято')).toBe(true)
    expect(canEditItems('Нове')).toBe(true)
  })

  it('після — ні: замовлення вже пообіцяли покупцю', () => {
    expect(canEditItems('Узгоджено')).toBe(false)
    expect(canEditItems('На доставці')).toBe(false)
  })

  it('але комплектувати можна саме тоді — це інша дія', () => {
    /* Поки це було одним правилом, маршрут комплектації відмовляв рівно
       в тому стані, заради якого існує */
    expect(canRecordPicking('Узгоджено', null)).toBe(true)
    expect(canRecordPicking('Узгоджено', '20450912345678')).toBe(false)
  })
})

describe('без оплати замовлення не їде', () => {
  it('доставка вимагає оплати', () => {
    expect(requiresPayment('На доставці')).toBe(true)
    expect(requiresPayment('Доставлено')).toBe(true)
  })

  it('до узгодження питати про гроші рано', () => {
    expect(requiresPayment('Прийнято')).toBe(false)
    expect(requiresPayment('Узгоджено')).toBe(false)
  })

  it('перемикач оплати відкритий саме на стадії узгодження', () => {
    expect(canTogglePaid('Узгоджено')).toBe(true)
    expect(canTogglePaid('Нове')).toBe(false)
    expect(canTogglePaid('На доставці')).toBe(false)
  })
})

describe('накладну роблять на узгоджене й лише раз', () => {
  it('на узгоджене без ТТН — можна', () => {
    expect(canCreateWaybill('Узгоджено', null)).toBe(true)
  })

  it('коли ТТН уже є — ні', () => {
    expect(canCreateWaybill('Узгоджено', '20450912345678')).toBe(false)
  })

  it('на неузгоджене — ні: склад іще зміниться, а вага поїде в накладну', () => {
    expect(canCreateWaybill('Прийнято', null)).toBe(false)
  })
})

describe('доставка рахується з суми товарів', () => {
  const line = (price: number) => ({
    title: 'Товар', unit: 'кг', unit_weight: 0, qty: 1, price_per_unit: price,
  })

  it('дешеве замовлення платить за доставку', () => {
    expect(deliveryFeeFor([line(100)])).toBeGreaterThan(0)
  })

  it('поріг не включний: рівно тисяча ще платить, тисяча з копійкою — ні', () => {
    /* Так написано в самому правилі — «понад цю суму (не включно)».
       Межа перевіряється тут, щоб її не зсунули випадково */
    expect(deliveryFeeFor([line(FREE_DELIVERY_FROM)])).toBe(DELIVERY_FEE)
    expect(deliveryFeeFor([line(FREE_DELIVERY_FROM + 0.01)])).toBe(0)
  })

  it('сам рядок доставки в поріг не зараховується', () => {
    /* Інакше доставка оплачувала б саму себе й зникала на межі */
    const goods = [line(FREE_DELIVERY_FROM - 1)]
    const withFee = [...goods, { ...line(99), title: DELIVERY_TITLE }]
    expect(deliveryFeeFor(withFee)).toBe(deliveryFeeFor(goods))
  })
})

describe('бланк без номера ящика', () => {
  /*
   * BX-201383: о 12:56:58 бланк пішов у чат, о 12:57:04 з'явився номер
   * 74. Склад отримав «Замовлення BX-201383» і не мав за чим шукати
   * ящик, хоч у Мерчанті номер уже стояв.
   */
  it('чекає, поки огляд не минув — номер ось-ось буде', () => {
    expect(holdSheetForNumber(null, null)).toBe(true)
  })

  it('не чекає, коли номер уже є', () => {
    expect(holdSheetForNumber(74, null)).toBe(false)
  })

  it('не чекає вічно: огляд минув, номера немає — шлемо як є', () => {
    /* Мовчання гірше за технічне ім'я: склад хоч дізнається про
       замовлення, а порожнє місце видно на сторінці стану */
    expect(holdSheetForNumber(null, '2026-10-31T12:57:04Z')).toBe(false)
  })

  it('нуль — теж номер, хай і дивний', () => {
    expect(holdSheetForNumber(0, null)).toBe(false)
  })
})

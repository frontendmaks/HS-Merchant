import { describe, it, expect } from 'vitest'
import { roundOffer, type PriceCategory } from '@/lib/price-category'
import { isHeldMark, MOVED_MARK, CANCELED_MARK } from '@/lib/manual-register'

const cat = (rounding: string, step: number) =>
  ({ rounding, rounding_step: step } as unknown as PriceCategory)

describe('ціна для маркетплейсу округлюється до десятих', () => {
  it('282,61 стає 282,7 — саме так просили', () => {
    expect(roundOffer(282.61, cat('up', 0.1))).toBe(282.7)
  })

  it('уже кругле не піднімається', () => {
    /* Дробовий крок рахується діленням, а воно в плаваючій комі дає
       282.6/0.1 = 2825.9999999999995 — і необережний ceil підняв би
       ціну там, де підіймати нема чого */
    expect(roundOffer(282.6, cat('up', 0.1))).toBe(282.6)
    expect(roundOffer(7.1, cat('up', 0.1))).toBe(7.1)
  })

  it('округлює вгору, а не вниз: копійка на користь продавця', () => {
    expect(roundOffer(99.91, cat('up', 0.1))).toBe(100)
    expect(roundOffer(1.05, cat('up', 0.1))).toBe(1.1)
  })

  it('жодна ціна не падає й не підскакує більш ніж на крок', () => {
    for (let cents = 1; cents <= 20000; cents++) {
      const price = cents / 100
      const r = roundOffer(price, cat('up', 0.1))
      expect(r).toBeGreaterThanOrEqual(price - 1e-9)
      expect(r - price).toBeLessThan(0.1 + 1e-9)
      expect(Math.abs(r * 10 - Math.round(r * 10))).toBeLessThan(1e-9)
    }
  })

  it('без категорії та з «none» ціну не чіпаємо', () => {
    expect(roundOffer(282.61, null)).toBe(282.61)
    expect(roundOffer(282.61, cat('none', 0.1))).toBe(282.61)
  })
})

describe('номер, закритий навмисно', () => {
  /*
   * Скасоване замовлення віддавало свій номер наступному. Але число вже
   * прозвучало: комірник написав «десятий» на наліпці, кур'єр має його в
   * маршруті. Другий «десятий» того самого дня плутає там, де плутати
   * найдорожче.
   */
  it('скасоване тримає номер', () => {
    expect(isHeldMark(CANCELED_MARK)).toBe(true)
  })

  it('перенесене теж', () => {
    expect(isHeldMark(`${MOVED_MARK}23.10`)).toBe(true)
  })

  it("звичайне ім'я номера не тримає — такий рядок прибирання звільняє", () => {
    expect(isHeldMark('Камінська Софія')).toBe(false)
    expect(isHeldMark(null)).toBe(false)
    expect(isHeldMark('')).toBe(false)
  })
})

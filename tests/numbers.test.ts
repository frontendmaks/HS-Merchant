import { describe, it, expect } from 'vitest'
import { nextFreeNumber } from '@/lib/number-register'

/**
 * Підставна база: віддає два списки, яких і питає видача номерів.
 *
 * Ланцюжок `.select().eq().is().not()` має бути очікуваним, тож кожен
 * крок повертає сам себе, а чекання віддає заготовлені рядки.
 */
function fakeDb(journal: number[], orders: { manual_number: number; status: string }[]) {
  const table = (rows: unknown[]) => {
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'is', 'not', 'neq', 'gte', 'in', 'order', 'limit']) {
      chain[m] = () => chain
    }
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null })
    return chain
  }
  return {
    from: (name: string) => name === 'order_numbers'
      ? table(journal.map(number => ({ number })))
      : table(orders),
  }
}

describe('номер скасованого замовлення не дістається наступному', () => {
  /*
   * 9 листопада BX-202104 узяло 41, його скасували — і через годину 41
   * дістало BX-202117, той самий клієнт, два ящики під одним числом.
   * 7 листопада номер 54 устиг побувати в трьох замовлень поспіль.
   *
   * Правило тримається самою вибіркою, а не написом у журналі.
   */
  it('скасоване тримає своє число', async () => {
    const db = fakeDb([], [
      { manual_number: 1, status: 'Комплектується' },
      { manual_number: 2, status: 'Скасовано' },
    ])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await nextFreeNumber(db as any, '2026-11-09')).toBe(3)
  })

  it('рядок журналу без замовлення теж тримає', async () => {
    const db = fakeDb([1, 2], [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await nextFreeNumber(db as any, '2026-11-09')).toBe(3)
  })

  it('дірку посередині віддаємо — вона справді вільна', async () => {
    const db = fakeDb([], [
      { manual_number: 1, status: 'Виконано' },
      { manual_number: 3, status: 'Скасовано' },
    ])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await nextFreeNumber(db as any, '2026-11-09')).toBe(2)
  })

  it('порожній день починається з першого', async () => {
    const db = fakeDb([], [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await nextFreeNumber(db as any, '2026-11-09')).toBe(1)
  })
})

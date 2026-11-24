/**
 * Звірка статусів із майданчиками.
 *
 * Статус приїжджає з майданчика, а показує його той самий `select`, з
 * якого оператор обирає наступний. Якщо слова немає в переліку, опції з
 * таким значенням теж немає — і браузер малює першу. Тобто замовлення в
 * «Очікує оплату» показувалось як «Нове», і ніхто цього не бачив.
 *
 * Тому перевіряємо обидва напрямки: кожне слово, яке майданчик може
 * надіслати, мусить бути в переліку; і кожна стадія очікування оплати
 * теж, бо саме на ній оператор позначає гроші.
 */
import { describe, it, expect } from 'vitest'
import { STATUS_MAP as MAUDAU_IN } from '@/lib/sync-maudau'
import { STATUS_MAP as PROM_IN } from '@/lib/sync-prom'
import { STATUS_MAP as ROZETKA_IN } from '@/lib/sync-rozetka'
import { statusOptions } from '@/lib/order-status-options'
import { PAYMENT_STAGE_BY_PLATFORM } from '@/lib/order-statuses'
import { promOrderToRow } from '@/lib/sync-prom'
import {
  MARKETPLACE_PLATFORMS, MARKETPLACE_LABELS, marketplaceLabel,
} from '@/lib/order-source'

const INCOMING: Record<string, Record<string | number, string>> = {
  maudau: MAUDAU_IN,
  prom: PROM_IN,
  rozetka: ROZETKA_IN,
}

describe('статуси майданчиків', () => {
  for (const [platform, map] of Object.entries(INCOMING)) {
    it(`${platform}: усе, що приходить, є в переліку`, () => {
      const options = statusOptions(platform)
      for (const word of new Set(Object.values(map))) {
        expect(options, `${platform} надсилає «${word}»`).toContain(word)
      }
    })
  }

  it('стадія очікування оплати є в переліку кожного майданчика', () => {
    for (const [platform, stages] of Object.entries(PAYMENT_STAGE_BY_PLATFORM)) {
      expect(stages.length, platform).toBeGreaterThan(0)
      for (const stage of stages) {
        expect(statusOptions(platform), `${platform}/${stage}`).toContain(stage)
      }
    }
  })
})

describe('комісія Prom', () => {
  it('береться з cpa_commission, а не лишається нулем', () => {
    const row = promOrderToRow({
      id: 1, status: 'received', price: '2 429,30 грн', products: [],
      cpa_commission: { amount: '391.00', is_refunded: false },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    expect(row.commission).toBe(391)
    expect(row.total).toBe(2429.3)
  })

  it('на скасованому замовленні комісію повертають — отже нуль', () => {
    const row = promOrderToRow({
      id: 2, status: 'canceled', price: '2 129,60 грн', products: [],
      cpa_commission: { amount: '333.26', is_refunded: true },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    expect(row.commission).toBe(0)
  })

  it('без комісії в відповіді — нуль, а не NaN', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = promOrderToRow({ id: 3, status: 'received', price: '10 грн', products: [] } as any)
    expect(row.commission).toBe(0)
  })
})

describe('фільтр майданчиків', () => {
  it('кожен майданчик має назву в очі', () => {
    for (const p of MARKETPLACE_PLATFORMS) {
      expect(marketplaceLabel(p), p).not.toBe(p === 'prom' ? '' : null)
      expect(marketplaceLabel(p).length, p).toBeGreaterThan(0)
    }
    expect(Object.keys(MARKETPLACE_LABELS).sort()).toEqual([...MARKETPLACE_PLATFORMS].sort())
  })
})

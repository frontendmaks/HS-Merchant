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

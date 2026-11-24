import { describe, it, expect } from 'vitest'
import { canTogglePaid, requiresPayment } from '@/lib/order-statuses'
import { PROM_STATUSES, statusOptions } from '@/lib/order-status-options'
import { PAYMENT_STAGE_BY_PLATFORM } from '@/lib/order-statuses'
import { PROM_STATUS_BACK } from '@/lib/sync-prom'
import { PROM_CANCEL_REASONS, PROM_REASON_CODE } from '@/lib/cancel-reasons'

describe('статуси Prom', () => {
  it('усі, крім «Нове», мають слово, яке Prom приймає', () => {
    for (const s of PROM_STATUSES.filter(s => s !== 'Нове')) {
      expect(PROM_STATUS_BACK[s], s).toBeTruthy()
    }
    /* pending і draft Prom не приймає — «Нове» лише приходить */
    expect(PROM_STATUS_BACK['Нове']).toBeUndefined()
  })

  it('«Оплачено» є в переліку і їде як paid', () => {
    expect(statusOptions('prom')).toContain('Оплачено')
    expect(PROM_STATUS_BACK['Оплачено']).toBe('paid')
  })

  it('кожна причина скасування має слово Prom', () => {
    for (const r of PROM_CANCEL_REASONS) {
      expect(PROM_REASON_CODE[r.name], r.name).toMatch(/^(not_available|duplicate)$/)
    }
  })

  it('те, чого Prom не знає, причиною не стає', () => {
    expect(PROM_REASON_CODE['Інше - додати коментар']).toBeUndefined()
    expect(PROM_REASON_CODE['other']).toBeUndefined()
  })
})

describe('оплату позначає оператор', () => {
  it('у Prom — на «Прийнято», бо інших стадій у нього немає', () => {
    expect(canTogglePaid('Прийнято', 'prom')).toBe(true)
    expect(canTogglePaid('Оплачено', 'prom')).toBe(true)
  })

  it('кожен майданчик має стадію, на якій чекають гроші', () => {
    for (const [platform, stages] of Object.entries(PAYMENT_STAGE_BY_PLATFORM)) {
      expect(stages.length, platform).toBeGreaterThan(0)
      for (const stage of stages) {
        expect(statusOptions(platform), `${platform}/${stage}`).toContain(stage)
      }
    }
  })

  it('МауДау лишився на «Узгоджено», не раніше', () => {
    expect(canTogglePaid('Узгоджено', 'maudau')).toBe(true)
    expect(canTogglePaid('Прийнято', 'maudau')).toBe(false)
    expect(canTogglePaid('Нове', 'maudau')).toBe(false)
  })

  it('без оплати замовлення не їде — на всіх майданчиках', () => {
    expect(requiresPayment('Доставлено')).toBe(true)
    expect(requiresPayment('На доставці')).toBe(true)
  })
})

import { describe, it, expect } from 'vitest'
import { isCashOnDelivery, requiresPayment } from '@/lib/order-statuses'
import { PROM_STATUSES, statusOptions } from '@/lib/order-status-options'
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

describe('накладений платіж', () => {
  it('упізнається так, як його пише Prom', () => {
    expect(isCashOnDelivery('Наложенный платеж')).toBe(true)
    expect(isCashOnDelivery('Післяплата')).toBe(true)
  })

  it('передоплата лишається передоплатою', () => {
    expect(isCashOnDelivery('Оплата картою онлайн')).toBe(false)
    expect(isCashOnDelivery(null)).toBe(false)
  })

  it('«Доставлено» саме по собі досі вимагає оплати', () => {
    expect(requiresPayment('Доставлено')).toBe(true)
  })
})

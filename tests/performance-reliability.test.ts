import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
import { deadline } from '@/lib/http'

const mock = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
  update: vi.fn(), rpc: vi.fn(), release: vi.fn(), lease: vi.fn(), after: vi.fn(),
}))
vi.mock('next/server', async importOriginal => ({
  ...await importOriginal<typeof import('next/server')>(), after: mock.after,
}))
vi.mock('@/lib/job-lease', () => ({ acquireLease: mock.lease }))
vi.mock('@/lib/bitrix-deal', () => ({ updateDealChecked: mock.update }))
vi.mock('@/lib/order-effects', () => ({ drainOrderEffects: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({
  rpc: mock.rpc,
  from: () => { const q = { select: () => q, eq: () => q, single: async () => ({ data: mock.current, error: null }) }; return q },
}) }))
import { changeOrderStatus } from '@/lib/order-status-change'

beforeEach(() => {
  vi.clearAllMocks()
  mock.current = { status: 'В обробці', platform: 'site', external_id: 'BX-123',
    bitrix_deal_id: 123, updated_at: '2026-11-05T09:00:00Z' }
  mock.update.mockResolvedValue(undefined)
  mock.rpc.mockResolvedValue({ data: true, error: null })
  mock.lease.mockResolvedValue(mock.release)
})
const input = { id: 'order', status: 'Комплектується', platform: 'rozetka', external_id: 'untrusted', actor: { id: 'actor', name: 'Operator' } }

describe('status transition reliability', () => {
  it('confirms external status before atomic local commit; defers side effects', async () => {
    const result = await changeOrderStatus(input)
    expect(result.status).toBe(200)
    expect(mock.update).toHaveBeenCalledWith(123, { STAGE_ID: 'C1:PREPAYMENT_INVOICE' })
    expect(mock.rpc).toHaveBeenCalledWith('merchant_commit_status', expect.objectContaining({ p_status: 'Комплектується' }))
    expect(mock.update.mock.invocationCallOrder[0]).toBeLessThan(mock.rpc.mock.invocationCallOrder[0])
    expect(mock.after).toHaveBeenCalledOnce()
    expect(mock.release).toHaveBeenCalledOnce()
  })
  it('does not repeat an already applied status', async () => {
    mock.current.status = 'Комплектується'
    expect((await changeOrderStatus(input)).status).toBe(200)
    expect(mock.update).not.toHaveBeenCalled()
    expect(mock.rpc).not.toHaveBeenCalled()
  })
  it('rejects a concurrent operator request before contacting Bitrix', async () => {
    mock.lease.mockResolvedValue(null)
    expect((await changeOrderStatus(input)).status).toBe(409)
    expect(mock.update).not.toHaveBeenCalled()
  })
  it('does not change the local status when Bitrix rejects the operation', async () => {
    mock.update.mockRejectedValue(new Error('Unavailable'))
    expect((await changeOrderStatus(input)).status).toBe(500)
    expect(mock.rpc).not.toHaveBeenCalled()
    expect(mock.after).not.toHaveBeenCalled()
    expect(mock.release).toHaveBeenCalledOnce()
  })
  it('detects a concurrent update instead of overwriting it', async () => {
    mock.rpc.mockResolvedValue({ data: false, error: null })
    expect((await changeOrderStatus(input)).status).toBe(409)
    expect(mock.after).not.toHaveBeenCalled()
  })
})

describe('bounded data loading', () => {
  it('does not send four requests for a small result', async () => {
    const range = vi.fn().mockResolvedValue({ data: [1, 2], error: null })
    expect(await fetchAllRows(() => ({ range }), 1000)).toEqual([1, 2])
    expect(range).toHaveBeenCalledOnce()
  })
  it('preserves all rows and order across parallel pages', async () => {
    const values = [0, 1, 2, 3, 4, 5, 6]
    expect(await fetchAllRows(() => ({ range: async (a, b) => ({ data: values.slice(a, b + 1), error: null }) }), 2, 2)).toEqual(values)
  })
  it('propagates failed pages rather than returning partial data', async () => {
    await expect(fetchAllRows(() => ({ range: async () => ({ data: null, error: new Error('db') }) }))).rejects.toThrow('db')
  })
  it('bounds a stalled auth check', async () => {
    await expect(deadline(new Promise(() => {}), 5)).rejects.toThrow('тимчасово')
  })
})

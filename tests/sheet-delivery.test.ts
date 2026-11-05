import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ bitrix: vi.fn(), claimed: false, state: 'sending', rpc: vi.fn() }))
vi.mock('@/lib/bitrix', () => ({ bitrix: mocks.bitrix }))
import { sendOrderSheet } from '@/lib/bitrix-chat'

function fakeDb() {
  return { rpc: mocks.rpc, from: (table: string) => {
    const q = { select: () => q, eq: () => q, update: () => q,
      single: async () => ({ data: { warehouse: 'Warehouse', share_token: 'token', manual_number: 42, chat_sent_at: null }, error: null }),
      maybeSingle: async () => ({ data: table === 'warehouse_chats' ? { dialog_id: 'chat1' } : {}, error: null }),
    }; return q
  } } as unknown as Parameters<typeof sendOrderSheet>[0]
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.claimed = false; mocks.state = 'sending'
  mocks.bitrix.mockResolvedValue(123)
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === 'merchant_claim_sheet') { const taken = mocks.claimed; mocks.claimed = true; return { data: !taken, error: null } }
    if (name === 'merchant_sheet_state') return { data: { state: mocks.state }, error: null }
    return { data: null, error: null }
  })
})
it('sends only once when the operator and sync race on the same order', async () => {
  await Promise.all([sendOrderSheet(fakeDb(), 'order'), sendOrderSheet(fakeDb(), 'order')])
  expect(mocks.bitrix).toHaveBeenCalledOnce()
  expect(mocks.bitrix).toHaveBeenCalledWith('im.message.add', expect.objectContaining({ DIALOG_ID: 'chat1' }))
})
it('does not blindly repeat an ambiguous timed-out send', async () => {
  mocks.bitrix.mockRejectedValue(new Error('timeout'))
  const first = await sendOrderSheet(fakeDb(), 'order')
  expect(first).toHaveProperty('error')
  expect(mocks.rpc).toHaveBeenCalledWith('merchant_finish_sheet', { p_order_id: 'order', p_error: 'timeout' })
  await sendOrderSheet(fakeDb(), 'order')
  expect(mocks.bitrix).toHaveBeenCalledOnce()
})
it('recovers a confirmed send when the old process missed updating orders', async () => {
  mocks.claimed = true; mocks.state = 'sent'
  expect(await sendOrderSheet(fakeDb(), 'order')).toEqual({ ok: true })
  expect(mocks.bitrix).not.toHaveBeenCalled()
})

import { expect, it, vi } from 'vitest'
import { cronHealth } from '@/lib/system-health'

it('keeps daily jobs healthy when more than 1000 newer runs exist', async () => {
  const recent = { name: 'bitrix-sync', ran_at: new Date().toISOString(), duration_ms: 100, error: null }
  const rows = [
    ...Array.from({ length: 1000 }, () => recent),
    { ...recent, name: 'customers', ran_at: new Date(Date.now() - 12 * 3600000).toISOString() },
  ]
  const query = {
    select: () => query, gte: () => query, order: () => query,
    range: vi.fn(async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null })),
  }
  const service = { from: () => query } as unknown as Parameters<typeof cronHealth>[0]
  const jobs = await cronHealth(service)
  expect(jobs.find(job => job.name === 'customers')).toMatchObject({ state: 'ok', runs24h: 1 })
  expect(jobs.find(job => job.name === 'bitrix-sync')).toMatchObject({ state: 'ok', runs24h: 1000 })
})

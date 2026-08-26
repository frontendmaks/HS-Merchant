'use client'

import { useState, useCallback, useEffect } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useOrderUpdates } from '@/lib/use-order-updates'

export default function OrdersToolbar() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Someone else changing an order should show here at once rather than at the
  // next poll — a stale status is how two operators work the same order.
  useOrderUpdates(() => router.refresh())

  // The poll stays as the floor: a dropped socket or a change made while the
  // tab was asleep still lands, just later.
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 60_000)
    const onFocus = () => router.refresh()
    window.addEventListener('focus', onFocus)
    return () => { clearInterval(timer); window.removeEventListener('focus', onFocus) }
  }, [router])

  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)
  const [syncFailed, setSyncFailed] = useState(false)

  const platform = searchParams.get('platform') || ''
  const status = searchParams.get('status') || ''
  const search = searchParams.get('search') || ''

  const setParam = useCallback((key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    params.delete('page')
    router.push(`${pathname}?${params.toString()}`)
  }, [searchParams, pathname, router])

  // Omitting `platform` syncs every marketplace; the route already handles
  // each one independently, so a failure on one still returns the other's count.
  async function syncAll() {
    setSyncing(true)
    setSyncResult(null)
    setSyncFailed(false)
    try {
      const res = await fetch('/api/sync/orders-manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      const total = (data.maudau_synced ?? 0) + (data.rozetka_synced ?? 0)
      if (data.success) {
        setSyncResult(`✓ ${total} замовлень`)
      } else {
        setSyncFailed(true)
        setSyncResult(data.error || 'Помилка синхронізації')
      }
      router.refresh()
    } catch {
      setSyncFailed(true)
      setSyncResult('Помилка мережі')
    } finally {
      setSyncing(false)
    }
  }

  const platforms = [
    { value: '', label: 'Всі' },
    { value: 'maudau', label: 'MauDau' },
    { value: 'rozetka', label: 'Rozetka' },
  ]

  const statuses = [
    { value: '', label: 'Всі статуси' },
    { value: 'Нове', label: 'Нове' },
    { value: 'Доставлено', label: 'Доставлено' },
    { value: 'Скасовано', label: 'Скасовано' },
    { value: 'other', label: 'В процесі' },
    { value: 'shipping', label: 'У доставці' },
  ]

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Search */}
      <input
        type="text"
        placeholder="Пошук за ПІБ або номером..."
        defaultValue={search}
        onChange={e => setParam('search', e.target.value)}
        className="bg-zinc-800 border border-zinc-700 text-white text-sm rounded-lg px-3 py-2 w-64 placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
      />

      {/* Platform filter */}
      <div className="flex gap-1">
        {platforms.map(p => (
          <button
            key={p.value}
            onClick={() => setParam('platform', p.value)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              platform === p.value
                ? 'bg-red-600 text-white'
                : 'bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Status filter */}
      <select
        value={status}
        onChange={e => setParam('status', e.target.value)}
        className="bg-zinc-800 border border-zinc-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-zinc-500"
      >
        {statuses.map(s => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>

      <div className="flex-1" />

      {/* Sync */}
      <div className="flex items-center gap-2">
        {syncResult && (
          <span className={`text-xs ${syncFailed ? 'text-red-400' : 'text-zinc-400'}`}>
            {syncResult}
          </span>
        )}
        <button
          onClick={syncAll}
          disabled={syncing}
          title="Синхронізувати замовлення з усіх маркетплейсів"
          className="flex items-center gap-1.5 px-3 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-60 text-white text-sm rounded-lg font-medium transition-colors"
        >
          <span className={syncing ? 'animate-spin inline-block' : ''}>↺</span>
          {syncing ? 'Оновлення...' : 'Оновити'}
        </button>
      </div>
    </div>
  )
}

'use client'

import { useState, useCallback } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'

export default function OrdersToolbar() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [syncingMaudau, setSyncingMaudau] = useState(false)
  const [syncingRozetka, setSyncingRozetka] = useState(false)
  const [maudauResult, setMaudauResult] = useState<string | null>(null)
  const [rozetkaResult, setRozetkaResult] = useState<string | null>(null)

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

  async function syncMaudau() {
    setSyncingMaudau(true)
    setMaudauResult(null)
    try {
      const res = await fetch('/api/sync/maudau', { method: 'POST' })
      const data = await res.json()
      setMaudauResult(data.success ? `Синхронізовано: ${data.synced}` : `Помилка: ${data.error}`)
      router.refresh()
    } catch (e) {
      setMaudauResult('Помилка мережі')
    } finally {
      setSyncingMaudau(false)
    }
  }

  async function syncRozetka() {
    setSyncingRozetka(true)
    setRozetkaResult(null)
    try {
      const res = await fetch('/api/sync/rozetka', { method: 'POST' })
      const data = await res.json()
      setRozetkaResult(data.success ? `Синхронізовано: ${data.synced}` : `Помилка: ${data.error}`)
      router.refresh()
    } catch (e) {
      setRozetkaResult('Помилка мережі')
    } finally {
      setSyncingRozetka(false)
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

      {/* Sync buttons */}
      <div className="flex items-center gap-2">
        {maudauResult && (
          <span className="text-xs text-zinc-400">{maudauResult}</span>
        )}
        <button
          onClick={syncMaudau}
          disabled={syncingMaudau}
          className="flex items-center gap-1.5 px-3 py-2 bg-purple-700 hover:bg-purple-600 disabled:opacity-60 text-white text-sm rounded-lg font-medium transition-colors"
        >
          <span className={syncingMaudau ? 'animate-spin inline-block' : ''}>↺</span>
          {syncingMaudau ? 'Синхронізація...' : 'MauDau'}
        </button>
        {rozetkaResult && (
          <span className="text-xs text-zinc-400">{rozetkaResult}</span>
        )}
        <button
          onClick={syncRozetka}
          disabled={syncingRozetka}
          className="flex items-center gap-1.5 px-3 py-2 bg-pink-700 hover:bg-pink-600 disabled:opacity-60 text-white text-sm rounded-lg font-medium transition-colors"
        >
          <span className={syncingRozetka ? 'animate-spin inline-block' : ''}>↺</span>
          {syncingRozetka ? 'Синхронізація...' : 'Rozetka'}
        </button>
      </div>
    </div>
  )
}

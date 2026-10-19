'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import WarehouseChats from './WarehouseChats'

/**
 * Налаштування прийому замовлень.
 *
 * Разові речі, які міняє керівник, а не оператор: за скільки хвилин до
 * початку періоду його перестають пропонувати, і в який чат іде бланк.
 */
export default function Settings({ buffer }: { buffer: number }) {
  const router = useRouter()
  const [value, setValue] = useState(String(buffer))
  const [saved, setSaved] = useState('')
  const [error, setError] = useState('')

  async function save() {
    setError('')
    setSaved('')
    const r = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'delivery_buffer_minutes', value: Number(value) }),
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { setError(d.error || 'Не зберіглось'); return }
    setSaved('збережено')
    router.refresh()
  }

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      <div className="flex items-center gap-2">
        <span className="text-zinc-400 text-xs">Період закривається за</span>
        <input
          value={value}
          onChange={e => setValue(e.target.value.replace(/\D/g, ''))}
          onBlur={() => { if (value !== String(buffer)) void save() }}
          className="w-14 bg-zinc-900 border border-zinc-800 rounded px-2 py-1
                     text-white text-xs text-center focus:outline-none focus:border-red-500"
        />
        <span className="text-zinc-400 text-xs">хв. до початку</span>
        {saved && <span className="text-emerald-500 text-xs">{saved}</span>}
        {error && <span className="text-red-400 text-xs">{error}</span>}
      </div>
      <WarehouseChats />
    </div>
  )
}

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
export default function Settings({ buffer, marketplace, warehouses = [], warehouse }: {
  buffer: number
  /** Чи приймає система маркетплейсні замовлення сама */
  marketplace?: boolean
  warehouses?: string[]
  warehouse?: string
}) {
  const router = useRouter()
  const [value, setValue] = useState(String(buffer))
  const [auto, setAuto] = useState(!!marketplace)
  const [saved, setSaved] = useState('')
  const [error, setError] = useState('')

  async function set(key: string, next: unknown) {
    setError('')
    const r = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value: next }),
    })
    if (!r.ok) {
      const d = await r.json().catch(() => ({}))
      setError(d.error || 'Не зберіглось')
      return false
    }
    router.refresh()
    return true
  }

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

      {/* Маркетплейси: прийняти замовлення там — обіцянка покупцеві, тож
          вмикається свідомо */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={auto}
          onChange={async e => {
            const next = e.target.checked
            setAuto(next)
            if (!await set('marketplace_autoprocess', next)) setAuto(!next)
          }}
          className="accent-red-500"
        />
        <span className="text-zinc-400 text-xs">
          Приймати маркетплейсні замовлення й заводити їх у Бітрікс
        </span>
      </label>

      {auto && warehouses.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-zinc-400 text-xs">Відвантаження зі складу</span>
          <select
            defaultValue={warehouse ?? ''}
            onChange={e => void set('marketplace_warehouse', e.target.value)}
            className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-white text-xs"
          >
            {warehouses.map(w => <option key={w} value={w}>{w}</option>)}
          </select>
        </div>
      )}
    </div>
  )
}

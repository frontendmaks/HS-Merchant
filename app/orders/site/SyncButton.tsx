'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

/**
 * «Оновити з Бітрікса» на вимогу.
 *
 * Розклад і так забирає зміни кожні чверть години, але оператор, який щойно
 * щось поправив у CRM, не має чекати чверть години, щоб у це повірити.
 */
export default function SyncButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [, start] = useTransition()

  async function run() {
    setBusy(true)
    setNote('')
    try {
      const r = await fetch('/api/orders/site/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: 3 }),
      })
      const d = await r.json()
      setNote(d.error
        ? `Помилка: ${d.error}`
        : `Переглянуто ${d.seen}, нових ${d.created}, оновлено ${d.updated}`)
      start(() => router.refresh())
    } catch {
      setNote('Немає зв’язку')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="text-right">
      <button
        onClick={() => void run()}
        disabled={busy}
        className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-white text-sm
                   px-3 py-2 rounded-lg transition-colors"
      >
        {busy ? 'Оновлюємо…' : '↻ З Бітрікса'}
      </button>
      {note && <div className="text-zinc-500 text-xs mt-1">{note}</div>}
    </div>
  )
}

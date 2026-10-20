'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import EditOrder from './EditOrder'

export default function EditButton({ id, warehouses, recheck }: {
  id: string
  warehouses: string[]
  /** Замовлення з хибою — поруч стають кнопки огляду й ручного рішення */
  recheck?: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [approving, setApproving] = useState(false)
  const [failed, setFailed] = useState('')

  /** Оператор вирішив, що замовлення готове: номер і комплектація одразу */
  async function approve() {
    setApproving(true)
    setFailed('')
    try {
      const r = await fetch(`/api/orders/${id}/approve`, { method: 'POST' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setFailed(d.error || 'не вдалося'); return }
      router.refresh()
    } finally {
      setApproving(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => setOpen(true)}
        className="text-zinc-400 hover:text-white text-xs transition-colors"
      >
        Правити
      </button>
      {recheck && (
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            await fetch(`/api/orders/${id}/site`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ recheck: true }),
            })
            router.refresh()
            setBusy(false)
          }}
          className="text-amber-500 hover:text-amber-400 text-xs transition-colors
                     disabled:opacity-40"
          title="Перевірити заново — після виправлення"
        >
          {busy ? '…' : '↻'}
        </button>
      )}
      {recheck && (
        <button
          disabled={approving}
          onClick={() => void approve()}
          className="text-emerald-500 hover:text-emerald-400 text-xs transition-colors
                     disabled:opacity-40 whitespace-nowrap"
          title="Взяти номер із журналу й перевести на комплектацію"
        >
          {approving ? '…' : '✓ на комплектацію'}
        </button>
      )}
      {failed && <span className="text-red-400 text-xs">{failed}</span>}
      {open && <EditOrder id={id} warehouses={warehouses} onClose={() => setOpen(false)} />}
    </div>
  )
}

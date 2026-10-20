'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import EditOrder from './EditOrder'

export default function EditButton({ id, warehouses, recheck }: {
  id: string
  warehouses: string[]
  /** Замовлення з хибою — поруч стає кнопка повторного огляду */
  recheck?: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

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
      {open && <EditOrder id={id} warehouses={warehouses} onClose={() => setOpen(false)} />}
    </div>
  )
}

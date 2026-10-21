'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import CancelDialog from '../CancelDialog'

/**
 * Видалення замовлення.
 *
 * Стоїть окремо від скасування й виглядає стримано: це різні дії.
 * Скасування лишає слід — у статистиці, в угоді, у причині. Видалення
 * не лишає нічого, і тому йому не місце поруч із щоденними кнопками.
 */
export default function DeleteButton({ id, label }: { id: string; label: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      const r = await fetch(`/api/orders/${id}`, { method: 'DELETE' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? 'Не вдалося видалити')
      setOpen(false)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Видалити замовлення назавжди"
        className="text-zinc-600 hover:text-red-400 text-xs transition-colors"
      >
        Видалити
      </button>

      {open && (
        <CancelDialog
          title={`Видалити ${label}?`}
          note={'Замовлення зникне з Мерчанта назавжди — разом із позиціями, '
            + 'подіями й листуванням по ньому. Угода в Бітріксі не стирається, '
            + 'а переходить у «Скасовано»; картка на дошці ховається в архів; '
            + 'номер ящика повертається в журнал.'}
          confirmLabel="Видалити"
          busy={busy}
          error={error}
          onCancel={() => { setOpen(false); setError(null) }}
          onConfirm={() => void remove()}
        />
      )}
    </>
  )
}

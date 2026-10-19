'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { statusOptions } from '@/lib/order-status-options'

/**
 * Статус у списку — без решти рядка.
 *
 * На оглядовій вкладці й на вкладці сайту потрібна рівно одна дія: перевести
 * замовлення в наступний стан. Усе інше — ТТН, склад, комплектація — робиться
 * там, де замовлення опрацьовують, і тягти сюди весь рядок маркетплейсу не
 * варто: він важить більше, ніж уся ця сторінка.
 */
export default function StatusSelect({ id, platform, externalId, status, disabled }: {
  id: string
  platform: string | null
  externalId: string | null
  status: string | null
  disabled?: boolean
}) {
  const router = useRouter()
  const [value, setValue] = useState(status || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function change(next: string) {
    const previous = value
    setValue(next)
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/orders/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next, platform, external_id: externalId ?? '' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.success === false) {
        // Відмову показуємо на місці й повертаємо попередній стан: інакше на
        // екрані стоїть статус, якого в базі немає
        setValue(previous)
        setError(data.error || 'Не вдалося змінити')
        return
      }
      router.refresh()
    } catch {
      setValue(previous)
      setError('Немає зв’язку')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <select
        value={value}
        disabled={disabled || busy}
        onChange={e => void change(e.target.value)}
        className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-white
                   focus:outline-none focus:border-red-500 disabled:opacity-50"
      >
        {!statusOptions(platform).includes(value) && value && (
          <option value={value}>{value}</option>
        )}
        {statusOptions(platform).map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      {error && <div className="text-red-400 text-xs mt-0.5 max-w-[14rem]">{error}</div>}
    </div>
  )
}

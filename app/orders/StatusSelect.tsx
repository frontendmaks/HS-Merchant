'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { statusOptions } from '@/lib/order-status-options'
import { SITE_CANCEL_REASONS } from '@/lib/cancel-reasons'

const CANCELED = 'Скасовано'

/**
 * Статус у списку — без решти рядка.
 *
 * На оглядовій вкладці й на вкладці сайту потрібна рівно одна дія: перевести
 * замовлення в наступний стан. Усе інше — ТТН, склад, комплектація — робиться
 * там, де замовлення опрацьовують, і тягти сюди весь рядок маркетплейсу не
 * варто: він важить більше, ніж уся ця сторінка.
 *
 * Виняток — скасування. Воно єдине закриває замовлення назавжди, і без
 * причини з нього потім нічого не дізнатись. Тому причину питаємо тут
 * само: доти оператор бачив лише відмову «спочатку оберіть причину», а
 * обрати її на цій вкладці не було де.
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
  const [asking, setAsking] = useState(false)
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')

  async function change(next: string, withReason?: string, comment?: string) {
    const previous = value
    setValue(next)
    setBusy(true)
    setError('')
    try {
      /*
       * Причина записується першою.
       *
       * Маршрут статусу відмовляє скасуванню без причини — і правильно
       * робить: причина, дописана після, вже нікого не рятує, бо
       * замовлення закрите й по ньому ніхто не повернеться.
       */
      if (withReason) {
        await fetch(`/api/orders/${id}/cancel-reason`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reason: comment?.trim() ? `${withReason} — ${comment.trim()}` : withReason,
          }),
        })
      }

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
      setAsking(false)
      setReason('')
      setNote('')
      router.refresh()
    } catch {
      setValue(previous)
      setError('Немає зв’язку')
    } finally {
      setBusy(false)
    }
  }

  function pick(next: string) {
    if (next === CANCELED) { setAsking(true); return }
    void change(next)
  }

  return (
    <div>
      <select
        value={value}
        disabled={disabled || busy}
        onChange={e => pick(e.target.value)}
        className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-white
                   focus:outline-none focus:border-red-500 disabled:opacity-50"
      >
        {!statusOptions(platform).includes(value) && value && (
          <option value={value}>{value}</option>
        )}
        {statusOptions(platform).map(s => <option key={s} value={s}>{s}</option>)}
      </select>

      {asking && (
        <div className="mt-1.5 w-64 bg-zinc-900 border border-zinc-700 rounded-lg p-2 space-y-2">
          <div className="text-zinc-400 text-xs">Чому скасовуємо?</div>

          <select
            value={reason}
            onChange={e => setReason(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1
                       text-xs text-white focus:outline-none focus:border-red-500"
          >
            <option value="">Оберіть причину…</option>
            {SITE_CANCEL_REASONS.map(group => (
              <optgroup key={group.group} label={group.group}>
                {group.items.map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </optgroup>
            ))}
          </select>

          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={2}
            placeholder="Коментар (не обов'язково)"
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1
                       text-xs text-white resize-none focus:outline-none focus:border-red-500"
          />

          <div className="flex gap-1.5">
            <button
              onClick={() => void change(CANCELED, reason, note)}
              disabled={!reason || busy}
              className="bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white
                         text-xs px-2.5 py-1 rounded transition-colors"
            >
              {busy ? '…' : 'Скасувати замовлення'}
            </button>
            <button
              onClick={() => { setAsking(false); setValue(status || ''); setError('') }}
              className="text-zinc-500 hover:text-white text-xs px-2 transition-colors"
            >
              Ні
            </button>
          </div>
        </div>
      )}

      {error && <div className="text-red-400 text-xs mt-0.5 max-w-[14rem]">{error}</div>}
    </div>
  )
}

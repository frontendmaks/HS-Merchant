'use client'

import { useState, useEffect } from 'react'

const MAUDAU_STATUSES = ['Нове', 'Прийнято', 'Узгоджено', 'На доставці', 'Прибуло', 'Доставлено', 'Скасовано']
const ROZETKA_STATUSES = ['Нове', 'Опрацьовується', 'Комплектується', 'Передано в доставку', 'Доставляється', 'Чекає в пункті', 'Доставлено', 'Скасовано']

const MAUDAU_CANCEL_REASONS_STATIC = [
  'Немає в наявності',
  'Покупець відмовився',
  'Відсутній товар',
  'Неправильне замовлення',
  'Технічна проблема',
]
const ROZETKA_CANCEL_REASONS = [
  'Немає в наявності',
  'Покупець відмовився',
  'Не влаштовує якість',
  'Пошкоджено при доставці',
  'Дублікат замовлення',
]

const TERMINAL_STATUSES = new Set(['Скасовано', 'Доставлено'])

function platformBadge(platform: string | null) {
  const p = platform || ''
  const cls =
    p === 'maudau'
      ? 'bg-purple-900 text-purple-300'
      : p === 'rozetka'
      ? 'bg-pink-900 text-pink-300'
      : 'bg-zinc-700 text-zinc-300'
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {p === 'maudau' ? 'MauDau' : p === 'rozetka' ? 'Rozetka' : p}
    </span>
  )
}

function fmt(n: number) {
  return n.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

interface OrderRowProps {
  id: string
  external_id: string
  platform: string
  order_date: string | null
  customer_name: string | null
  customer_phone: string | null
  address: string | null
  items: string | null
  total: number | null
  commission: number | null
  status: string | null
  ttn: string | null
  cancel_reason: string | null
}

export default function OrderRow(props: OrderRowProps) {
  const [status, setStatus] = useState(props.status || '')
  const [ttn, setTtn] = useState(props.ttn || '')
  const [ttnDraft, setTtnDraft] = useState(props.ttn || '')
  const [cancelReason, setCancelReason] = useState(props.cancel_reason || '')

  const [statusLoading, setStatusLoading] = useState(false)
  const [ttnLoading, setTtnLoading] = useState(false)
  const [cancelLoading, setCancelLoading] = useState(false)

  const [statusError, setStatusError] = useState('')
  const [ttnError, setTtnError] = useState('')
  const [cancelError, setCancelError] = useState('')

  // MauDau dynamic cancel reasons
  const [maudauReasons, setMaudauReasons] = useState<{ id: number; name: string }[]>([])
  const [maudauReasonsLoading, setMaudauReasonsLoading] = useState(false)

  useEffect(() => {
    if (props.platform !== 'maudau') return
    setMaudauReasonsLoading(true)
    fetch('/api/orders/maudau-cancel-reasons')
      .then(r => r.json())
      .then((data: { reasons?: { id: number; name: string }[] }) => {
        if (data.reasons && data.reasons.length > 0) {
          setMaudauReasons(data.reasons)
        } else {
          // Fallback to static list represented as id-less objects for uniform rendering
          setMaudauReasons(
            MAUDAU_CANCEL_REASONS_STATIC.map((name, i) => ({ id: -(i + 1), name })),
          )
        }
      })
      .catch(() => {
        setMaudauReasons(
          MAUDAU_CANCEL_REASONS_STATIC.map((name, i) => ({ id: -(i + 1), name })),
        )
      })
      .finally(() => setMaudauReasonsLoading(false))
  }, [props.platform])

  const statuses = props.platform === 'rozetka' ? ROZETKA_STATUSES : MAUDAU_STATUSES
  const cancelReasonNames =
    props.platform === 'rozetka'
      ? ROZETKA_CANCEL_REASONS
      : maudauReasons.map(r => r.name)

  async function handleStatusChange(newStatus: string) {
    setStatusError('')
    setStatusLoading(true)
    try {
      const res = await fetch(`/api/orders/${props.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, platform: props.platform, external_id: props.external_id }),
      })
      const data = (await res.json()) as { success: boolean; error?: string }
      if (!data.success) throw new Error(data.error || 'Помилка оновлення статусу')
      setStatus(newStatus)
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : String(e))
    } finally {
      setStatusLoading(false)
    }
  }

  async function handleTtnBlur() {
    if (ttnDraft === ttn) return
    setTtnError('')
    setTtnLoading(true)
    try {
      const res = await fetch(`/api/orders/${props.id}/ttn`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttn: ttnDraft, platform: props.platform, external_id: props.external_id }),
      })
      const data = (await res.json()) as { success: boolean; error?: string }
      if (!data.success) throw new Error(data.error || 'Помилка оновлення ТТН')
      setTtn(ttnDraft)
    } catch (e) {
      setTtnError(e instanceof Error ? e.message : String(e))
      setTtnDraft(ttn)
    } finally {
      setTtnLoading(false)
    }
  }

  async function handleCancelReasonChange(reason: string) {
    if (!reason) return
    setCancelError('')
    setCancelLoading(true)
    try {
      const res = await fetch(`/api/orders/${props.id}/cancel`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, platform: props.platform, external_id: props.external_id }),
      })
      const data = (await res.json()) as { success: boolean; error?: string }
      if (!data.success) throw new Error(data.error || 'Помилка скасування')
      setStatus('Скасовано')
      setCancelReason(reason)
    } catch (e) {
      setCancelError(e instanceof Error ? e.message : String(e))
    } finally {
      setCancelLoading(false)
    }
  }

  const selectCls =
    'bg-zinc-800 text-white border border-zinc-700 rounded px-1 py-0.5 text-xs w-full disabled:opacity-50 cursor-pointer'

  const isTerminal = TERMINAL_STATUSES.has(status)

  return (
    <tr className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors align-top">
      <td className="px-3 py-2 whitespace-nowrap text-zinc-400 text-xs">{props.order_date || '—'}</td>
      <td className="px-3 py-2 whitespace-nowrap text-zinc-300 font-mono text-xs">{props.external_id}</td>
      <td className="px-3 py-2 whitespace-nowrap">{platformBadge(props.platform)}</td>
      <td className="px-3 py-2 whitespace-nowrap text-zinc-300 text-xs">{props.customer_name || '—'}</td>
      <td className="px-3 py-2 whitespace-nowrap text-zinc-400 text-xs">{props.customer_phone || '—'}</td>
      <td className="px-3 py-2 text-zinc-400 text-xs min-w-[160px] max-w-[220px] break-words">
        {props.address || '—'}
      </td>
      <td className="px-3 py-2 text-zinc-400 text-xs min-w-[280px] max-w-[380px]">
        {props.items
          ? props.items.split('\n').filter(Boolean).map((line, i) => (
              <div key={i} className="py-0.5 border-b border-zinc-800/40 last:border-0 leading-snug">
                {line}
              </div>
            ))
          : '—'}
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-right text-zinc-300 text-xs">
        {props.total != null ? `₴${fmt(Number(props.total))}` : '—'}
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-right text-amber-400 text-xs">
        {props.commission != null ? `₴${fmt(Number(props.commission))}` : '—'}
      </td>

      {/* Status */}
      <td className="px-3 py-2 min-w-[140px]">
        <select
          value={status}
          disabled={statusLoading || isTerminal}
          onChange={e => handleStatusChange(e.target.value)}
          className={selectCls}
        >
          {statuses.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        {statusLoading && <div className="text-zinc-500 text-xs mt-0.5">Оновлення...</div>}
        {statusError && <div className="text-red-400 text-xs mt-0.5">{statusError}</div>}
      </td>

      {/* TTN */}
      <td className="px-3 py-2 min-w-[120px]">
        <input
          type="text"
          value={ttnDraft}
          disabled={ttnLoading}
          onChange={e => setTtnDraft(e.target.value)}
          onBlur={handleTtnBlur}
          className="bg-zinc-800 text-white border border-zinc-700 rounded px-1 py-0.5 text-xs font-mono w-full disabled:opacity-50"
          placeholder="ТТН"
        />
        {ttnLoading && <div className="text-zinc-500 text-xs mt-0.5">Збереження...</div>}
        {ttnError && <div className="text-red-400 text-xs mt-0.5">{ttnError}</div>}
      </td>

      {/* Cancel reason */}
      <td className="px-3 py-2 min-w-[160px]">
        {status !== 'Доставлено' && (
          <>
            <select
              value={cancelReason}
              disabled={cancelLoading || maudauReasonsLoading || status === 'Скасовано'}
              onChange={e => handleCancelReasonChange(e.target.value)}
              className={selectCls}
            >
              <option value="">
                {maudauReasonsLoading ? 'Завантаження...' : '—'}
              </option>
              {cancelReasonNames.map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            {cancelLoading && <div className="text-zinc-500 text-xs mt-0.5">Скасування...</div>}
            {cancelError && <div className="text-red-400 text-xs mt-0.5">{cancelError}</div>}
          </>
        )}
      </td>
    </tr>
  )
}

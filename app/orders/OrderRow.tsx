'use client'

import { useState, useEffect } from 'react'
import OrderJournal from './OrderJournal'
import OrderItemsEditor from './OrderItemsEditor'
import ShipmentDialog from './ShipmentDialog'
import { useRouter } from 'next/navigation'
import { canCreateWaybill, canEditItems, isHandedOver } from '@/lib/order-statuses'
import { useOrderUpdates } from '@/lib/use-order-updates'

const MAUDAU_STATUSES = ['Нове', 'Прийнято', 'Узгоджено', 'На доставці', 'Прибуло', 'Доставлено', 'Скасовано']
const ROZETKA_STATUSES = ['Нове', 'Опрацьовується', 'Комплектується', 'Передано в доставку', 'Доставляється', 'Чекає в пункті', 'Доставлено', 'Скасовано']

// Exact names from MauDau API /v1/merchant_public_api/orders/cancellation_reasons
// Used as fallback if API call fails
const MAUDAU_CANCEL_REASONS_STATIC = [
  { id: 12,  name: 'Доставка: Відміна при доставці' },
  { id: 44,  name: 'Термін: Не готовий очікувати товар під замовлення' },
  { id: 45,  name: 'Термін: Протермінована поставка товару' },
  { id: 47,  name: 'Наявність товару: Немає у наявності' },
  { id: 49,  name: 'Ціна: Не влаштовує вартість доставки' },
  { id: 53,  name: 'Система: Тестове замовлення' },
  { id: 55,  name: 'Гість: Відмовився (не актуально)' },
  { id: 56,  name: 'Гість: Немає відповіді від Гостя' },
  { id: 57,  name: 'Гість: Замовив не той товар' },
  { id: 58,  name: 'Гість: Не влаштовує час доставки' },
  { id: 60,  name: 'Наявність товару: Товару немає у потрібній кількості' },
  { id: 61,  name: 'Оплата: Не підходить спосіб оплати' },
  { id: 62,  name: 'Оплата: Немає оплати' },
  { id: 63,  name: 'Гість: Замовив в іншому магазині' },
  { id: 64,  name: 'Гість: Думав, що замовив у MAUDAU' },
  { id: 65,  name: 'Гість: Не підійшли характеристики товару' },
  { id: 66,  name: 'Товар: Брак' },
  { id: 67,  name: 'Ціна: Не актуальна ціна' },
  { id: 68,  name: 'Гість: Дубль замовлення' },
  { id: 69,  name: 'Інше - додати коментар' },
]

// Rozetka cancel reasons — status ID encodes the reason
const ROZETKA_CANCEL_REASONS = [
  { id: 45, name: 'Скасовано покупцем' },
  { id: 40, name: 'Клієнт передумав' },
  { id: 16, name: 'Немає в наявності' },
  { id: 18, name: 'Не вдалося зв\'язатися' },
  { id: 44, name: 'Фейкове замовлення' },
  { id: 11, name: 'Не прийшов' },
  { id: 12, name: 'Відмова при отриманні' },
  { id: 17, name: 'Не влаштовує оплата' },
  { id: 19, name: 'Повернено' },
  { id: 50, name: 'Клієнт не оплатив' },
  { id: 13, name: 'Скасовано' },
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
  /** "HH:mm" the marketplace stamped on the order, in Kyiv time */
  arrival: string | null
  customer_name: string | null
  customer_phone: string | null
  address: string | null
  branch: string | null
  items: string | null
  total: number | null
  commission: number | null
  status: string | null
  ttn: string | null
  cancel_reason: string | null
  /** What the buyer wrote when ordering — delivery notes, corrected addresses */
  customer_comment: string | null
  readOnly?: boolean
  canSeeJournal?: boolean
}

export default function OrderRow(props: OrderRowProps & { readOnly?: boolean }) {
  const readOnly = props.readOnly ?? false
  const router = useRouter()
  const [status, setStatus] = useState(props.status || '')
  const [ttn, setTtn] = useState(props.ttn || '')
  const [ttnDraft, setTtnDraft] = useState(props.ttn || '')
  const [cancelReason, setCancelReason] = useState(props.cancel_reason || '')

  useEffect(() => {
    setStatus(props.status || '')
    setTtn(props.ttn || '')
    setTtnDraft(props.ttn || '')
    setCancelReason(props.cancel_reason || '')
  }, [props.status, props.ttn, props.cancel_reason])

  // This row holds its own copy of status and TTN so typing feels immediate.
  // That copy goes stale the moment someone else touches the same order, so
  // pull the server's view back when it does.
  useOrderUpdates(change => {
    if (change.orderId === props.id) router.refresh()
  })

  const [journalOpen, setJournalOpen] = useState(false)
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
          setMaudauReasons(MAUDAU_CANCEL_REASONS_STATIC)
        }
      })
      .catch(() => {
        setMaudauReasons(MAUDAU_CANCEL_REASONS_STATIC)
      })
      .finally(() => setMaudauReasonsLoading(false))
  }, [props.platform])

  const statuses = props.platform === 'rozetka' ? ROZETKA_STATUSES : MAUDAU_STATUSES
  const cancelReasonOptions: { id: number; name: string }[] =
    props.platform === 'rozetka'
      ? ROZETKA_CANCEL_REASONS
      : maudauReasons

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
      if (status === 'Скасовано') {
        // Order already canceled — just update DB, don't call marketplace API
        const res = await fetch(`/api/orders/${props.id}/cancel-reason`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason }),
        })
        const data = (await res.json()) as { success: boolean; error?: string }
        if (!data.success) throw new Error(data.error || 'Помилка збереження причини')
        setCancelReason(reason)
      } else {
        const res = await fetch(`/api/orders/${props.id}/cancel`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason, platform: props.platform, external_id: props.external_id }),
        })
        const data = (await res.json()) as { success: boolean; error?: string }
        if (!data.success) throw new Error(data.error || 'Помилка скасування')
        setStatus('Скасовано')
        setCancelReason(reason)
      }
    } catch (e) {
      setCancelError(e instanceof Error ? e.message : String(e))
    } finally {
      setCancelLoading(false)
    }
  }

  const selectCls =
    'bg-zinc-800 text-white border border-zinc-700 rounded px-1 py-0.5 text-xs w-full disabled:opacity-50 cursor-pointer'

  const isTerminal = TERMINAL_STATUSES.has(status)
  // With the courier and carrying a number, the marketplace drives it from here
  const handedOver = isHandedOver(status, ttn)
  const locked = isTerminal || handedOver

  return (
    <>
    <tr
      onClick={() => setJournalOpen(true)}
      title="Натисніть, щоб побачити журнал змін"
      className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors align-top cursor-pointer"
    >
      <td className="px-3 py-2 whitespace-nowrap text-zinc-400 text-xs">{props.order_date || '—'}</td>
      <td className="px-3 py-2 whitespace-nowrap text-zinc-300 font-mono text-xs">{props.external_id}</td>
      <td className="px-3 py-2 whitespace-nowrap">{platformBadge(props.platform)}</td>
      <td className="px-3 py-2 whitespace-nowrap text-zinc-300 text-xs">{props.customer_name || '—'}</td>
      <td className="px-3 py-2 whitespace-nowrap text-zinc-400 text-xs">{props.customer_phone || '—'}</td>
      <td className="px-3 py-2 text-zinc-400 text-xs min-w-[160px] max-w-[220px] break-words">
        {props.address || '—'}
      </td>
      <td className="px-3 py-2 text-zinc-300 text-xs min-w-[150px] max-w-[210px] break-words">
        {props.branch || '—'}
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
      <td onClick={e => e.stopPropagation()} className="px-3 py-2 min-w-[140px]">
        {readOnly ? (
          <span className="text-zinc-300 text-xs">{status}</span>
        ) : (
          <>
            <select
              value={status}
              disabled={statusLoading || locked}
              onChange={e => handleStatusChange(e.target.value)}
              className={selectCls}
            >
              {statuses.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            {statusLoading && <div className="text-zinc-500 text-xs mt-0.5">Оновлення...</div>}
            {statusError && <div className="text-red-400 text-xs mt-0.5">{statusError}</div>}
          </>
        )}
      </td>

      {/* TTN */}
      <td onClick={e => e.stopPropagation()} className="px-3 py-2 min-w-[168px]">
        {readOnly ? (
          <span className="text-zinc-400 text-xs font-mono">{ttn || '—'}</span>
        ) : (
          <>
            <input
              type="text"
              value={ttnDraft}
              disabled={ttnLoading || locked}
              onChange={e => setTtnDraft(e.target.value)}
              onBlur={handleTtnBlur}
              className="bg-zinc-800 text-white border border-zinc-700 rounded px-1 py-0.5 text-xs font-mono w-full disabled:opacity-50 read-only:cursor-default"
              placeholder="ТТН"
              readOnly={locked}
            />
            {handedOver && !ttnLoading && (
              <div className="text-zinc-600 text-xs mt-0.5">в доставці</div>
            )}
            {ttnLoading && <div className="text-zinc-500 text-xs mt-0.5">Збереження...</div>}
            {ttnError && <div className="text-red-400 text-xs mt-0.5">{ttnError}</div>}
          </>
        )}
      </td>

      {/* Cancel reason */}
      <td onClick={e => e.stopPropagation()} className="px-3 py-2 min-w-[160px]">
        {readOnly ? (
          <span className="text-zinc-400 text-xs">{cancelReason || '—'}</span>
        ) : status === 'Скасовано' ? (
          // Already cancelled — the reason is on record, not up for revision
          <span className="text-zinc-400 text-xs">{cancelReason || '—'}</span>
        ) : status !== 'Доставлено' && (
          <>
            <select
              value={cancelReason}
              disabled={cancelLoading || maudauReasonsLoading}
              onChange={e => handleCancelReasonChange(e.target.value)}
              className={selectCls}
            >
              <option value="">
                {maudauReasonsLoading ? 'Завантаження...' : '—'}
              </option>
              {cancelReasonOptions.map(r => (
                <option key={r.id} value={r.name}>{r.name}</option>
              ))}
            </select>
            {cancelLoading && <div className="text-zinc-500 text-xs mt-0.5">
              {status === 'Скасовано' ? 'Збереження...' : 'Скасування...'}
            </div>}
            {cancelError && <div className="text-red-400 text-xs mt-0.5">{cancelError}</div>}
          </>
        )}
      </td>
    </tr>

    {journalOpen && (
      <OrderDetailModal
        {...props}
        status={status}
        ttn={ttn}
        cancelReason={cancelReason}
        onClose={() => setJournalOpen(false)}
        // The waybill is created inside the modal but the row owns these fields
        onShipmentCreated={({ ttn: created, status: newStatus }) => {
          setTtn(created)
          setTtnDraft(created)
          if (newStatus) setStatus(newStatus)
        }}
      />
    )}
    </>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-zinc-500 text-xs">{label}</div>
      <div className="text-zinc-200 text-sm mt-0.5 break-words">{value || '—'}</div>
    </div>
  )
}

function OrderDetailModal(
  props: OrderRowProps & {
    status: string; ttn: string; cancelReason: string
    onClose: () => void
    onShipmentCreated: (r: { ttn: string; status?: string }) => void
  },
) {
  const { onClose } = props
  const [shipmentOpen, setShipmentOpen] = useState(false)
  const itemsEditable = canEditItems(props.status)
  // Either already gone, or a waybill exists — nothing to create twice
  const shipped = isHandedOver(props.status, props.ttn) || !!props.ttn
  const canShip = canCreateWaybill(props.status, props.ttn)
  return (
    <tr>
      <td colSpan={13} className="p-0">
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center p-4 overflow-y-auto"
          onClick={onClose}
        >
          <div
            className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-5xl my-8 text-left"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-zinc-800 flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  {platformBadge(props.platform)}
                  <span className="text-zinc-300 font-mono text-sm">{props.external_id}</span>
                  <span className="text-zinc-600 text-xs">
                    {props.order_date}
                    {props.arrival && <span className="text-zinc-500"> о {props.arrival}</span>}
                  </span>
                  {props.customer_comment && (
                    <span className="text-amber-400 text-xs" title="Клієнт залишив коментар">
                      ✎ коментар
                    </span>
                  )}
                </div>
                <h3 className="text-white font-semibold mt-1.5">{props.customer_name || '—'}</h3>
              </div>
              <button onClick={onClose} className="text-zinc-500 hover:text-white text-xl leading-none px-1">×</button>
            </div>

            <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Статус" value={props.status} />
                  <Field label="ТТН" value={props.ttn} />
                  <Field label="Сума" value={props.total != null ? `₴${fmt(Number(props.total))}` : null} />
                  <Field label="Комісія" value={props.commission != null ? `₴${fmt(Number(props.commission))}` : null} />
                </div>
                <Field label="Телефон" value={props.customer_phone} />
                <Field label="Відділення" value={props.branch} />
                <Field label="Адреса" value={props.address} />

                {/* Placed under the address on purpose: a comment often
                    corrects or qualifies exactly that, and reading one after
                    the other is how the operator catches it */}
                {props.customer_comment && (
                  <div>
                    <div className="text-amber-400/90 text-xs">Коментар клієнта</div>
                    <div className="text-zinc-100 text-sm mt-1 whitespace-pre-wrap bg-amber-950/20 border border-amber-900/40 rounded-lg px-3 py-2">
                      {props.customer_comment}
                    </div>
                  </div>
                )}

                {props.cancelReason && <Field label="Причина скасування" value={props.cancelReason} />}

              </div>

              {props.canSeeJournal && (
                <div>
                  <div className="text-zinc-400 text-xs mb-3">Журнал змін</div>
                  <div className="max-h-[420px] overflow-y-auto pr-1">
                    <OrderJournal orderId={props.id} />
                  </div>
                </div>
              )}
            </div>

            <div className="px-5 pb-5">
              <div className="text-zinc-400 text-xs mb-3">
                Товари та коригування
                {itemsEditable
                  ? <span className="text-zinc-600"> — впишіть фактичну вагу з накладної</span>
                  : <span className="text-zinc-600">
                      {' '}— замовлення у статусі «{props.status}», склад уже погоджено
                    </span>}
              </div>
              <OrderItemsEditor orderId={props.id} readOnly={!itemsEditable} />
            </div>

            <div className="px-5 py-3 border-t border-zinc-800 flex justify-between items-center gap-3">
              {shipped ? (
                <span className="text-zinc-500 text-sm">
                  Передано в доставку · ТТН {props.ttn}
                </span>
              ) : !canShip ? (
                <span className="text-zinc-600 text-sm">
                  ТТН створюється з погодженого замовлення — зараз «{props.status}»
                </span>
              ) : (
                <button
                  onClick={() => setShipmentOpen(true)}
                  className="px-4 py-2 rounded-lg text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors"
                >
                  ▤ Створити ТТН
                </button>
              )}
              <button
                onClick={onClose}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded-lg transition-colors"
              >
                Закрити
              </button>
            </div>
          </div>

          {shipmentOpen && (
            <ShipmentDialog
              orderId={props.id}
              onClose={() => setShipmentOpen(false)}
              onCreated={props.onShipmentCreated}
            />
          )}
        </div>
      </td>
    </tr>
  )
}

'use client'

import { useEffect, useState } from 'react'

interface Shipment {
  order: {
    external_id: string
    recipient: string | null
    phone: string | null
    branch: string | null
    address: string | null
    cost: number
    originalCost: number
    ttn: string | null
  }
  weight: { computed: number; assumed: string[]; saved: number | null }
  seats: number
  recipientRefs: { cityRef: string | null; warehouseRef: string | null }
  delivery: { toBranch: boolean; street: string | null; building: string | null; flat: string | null }
  sender: { current: string | null; branches: { ref: string; description: string }[] }
  ready: { apiKey: boolean; sender: boolean; cityRef: boolean; destination: boolean }
}

const money = (n: number) =>
  `₴${Number(n).toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const MISSING_LABEL: Record<keyof Shipment['ready'], string> = {
  apiKey: 'ключ API Нової Пошти (змінна NOVA_POSHTA_API_KEY)',
  sender: 'дані відправника (таблиця np_settings)',
  cityRef: 'ідентифікатор міста одержувача',
  destination: 'адреса призначення — немає ні відділення, ні вулиці з будинком',
}

export default function ShipmentDialog({ orderId, onClose, onCreated }: {
  orderId: string
  onClose: () => void
  /** Lets the order row show the new number and status without a reload */
  onCreated?: (result: { ttn: string; status?: string }) => void
}) {
  const [data, setData] = useState<Shipment | null>(null)
  const [error, setError] = useState('')
  const [weight, setWeight] = useState('')
  const [seats, setSeats] = useState('1')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [senderRef, setSenderRef] = useState('')
  const [dims, setDims] = useState({ length: '', width: '', height: '' })
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<{
    ttn?: string; cost?: number; estimatedDelivery?: string
    status?: string; marketplaceError?: string
  } | null>(null)
  const [createError, setCreateError] = useState('')

  useEffect(() => {
    fetch(`/api/orders/${orderId}/shipment`)
      .then(r => r.json())
      .then((d: Shipment & { error?: string }) => {
        if (d.error) { setError(d.error); return }
        setData(d)
        setWeight(String(d.weight.saved ?? d.weight.computed))
        setSeats(String(d.seats ?? 1))
        setSenderRef(d.sender?.current ?? '')
      })
      .catch(() => setError('Не вдалося завантажити дані відправлення'))
  }, [orderId])

  async function save() {
    setSaving(true)
    try {
      const res = await fetch(`/api/orders/${orderId}/shipment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weight: Number(weight.replace(',', '.')),
          seats: Number(seats),
        }),
      })
      if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 3000) }
    } finally {
      setSaving(false)
    }
  }

  async function createTtn() {
    setCreating(true)
    setCreateError('')
    try {
      const res = await fetch(`/api/orders/${orderId}/shipment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weight: Number(weight.replace(',', '.')),
          seats: Number(seats),
          senderAddressRef: senderRef || undefined,
          dimensions: dims.length && dims.width && dims.height
            ? { length: Number(dims.length), width: Number(dims.width), height: Number(dims.height) }
            : undefined,
        }),
      })
      const d = await res.json()
      if (!res.ok || d.error) { setCreateError(d.error || 'Не вдалося створити ТТН'); return }
      setCreated(d)
      if (d.ttn) onCreated?.({ ttn: d.ttn, status: d.status })
    } catch {
      setCreateError('Помилка мережі')
    } finally {
      setCreating(false)
    }
  }

  const missing = data
    ? (Object.keys(data.ready) as (keyof Shipment['ready'])[]).filter(k => !data.ready[k])
    : []

  const field = 'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-red-500'

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-lg my-12"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
          <span className="text-white font-semibold">Створити ТТН</span>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-xl leading-none">×</button>
        </div>

        {error && <div className="p-5 text-red-400 text-sm">{error}</div>}
        {!data && !error && <div className="p-5 text-zinc-600 text-sm">Завантаження...</div>}

        {data && (
          <div className="p-5 space-y-4">
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-zinc-500">Одержувач</span>
                <span className="text-zinc-200 text-right">{data.order.recipient ?? '—'}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-zinc-500">Телефон</span>
                <span className="text-zinc-200">{data.order.phone ?? '—'}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-zinc-500">Куди</span>
                <span className="text-zinc-200 text-right">
                  {data.delivery.toBranch
                    ? (data.order.branch ?? '—')
                    : [data.delivery.street, data.delivery.building, data.delivery.flat && `кв. ${data.delivery.flat}`]
                        .filter(Boolean).join(', ') || '—'}
                  {!data.delivery.toBranch && (
                    <span className="block text-cyan-500 text-xs">курʼєром на адресу</span>
                  )}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-zinc-500">Оголошена вартість</span>
                <span className="text-zinc-200 text-right">
                  {money(data.order.cost)}
                  {Math.abs(data.order.cost - data.order.originalCost) >= 0.01 && (
                    <span className="block text-zinc-600 text-xs">
                      було {money(data.order.originalCost)} до коригування
                    </span>
                  )}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-zinc-500">Доставку оплачує</span>
                <span className="text-zinc-200">Одержувач, готівкою</span>
              </div>
            </div>

            {data.sender.branches.length > 0 && (
              <div>
                <label className="block text-zinc-400 text-xs mb-1.5">Відправка з відділення</label>
                <select
                  value={senderRef}
                  onChange={e => setSenderRef(e.target.value)}
                  className={field}
                >
                  {data.sender.branches.map(b => (
                    <option key={b.ref} value={b.ref}>{b.description}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-zinc-400 text-xs mb-1.5">Вага, кг</label>
                <input value={weight} onChange={e => setWeight(e.target.value)} inputMode="decimal" className={field} />
                <div className="text-zinc-600 text-xs mt-1">
                  Розраховано з позицій: {data.weight.computed} кг
                </div>
              </div>
              <div>
                <label className="block text-zinc-400 text-xs mb-1.5">Місць</label>
                <input value={seats} onChange={e => setSeats(e.target.value)} inputMode="numeric" className={field} />
              </div>
            </div>

            <div>
              <label className="block text-zinc-400 text-xs mb-1.5">
                Габарити, см <span className="text-zinc-600">— необовʼязково</span>
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(['length', 'width', 'height'] as const).map((k, i) => (
                  <input
                    key={k}
                    value={dims[k]}
                    onChange={e => setDims(d => ({ ...d, [k]: e.target.value }))}
                    placeholder={['довжина', 'ширина', 'висота'][i]}
                    inputMode="numeric"
                    className={field}
                  />
                ))}
              </div>
              <div className="text-zinc-600 text-xs mt-1">
                Якщо не заповнити, Нова Пошта порахує обʼєм за вагою.
              </div>
            </div>

            {data.weight.assumed.length > 0 && (
              <div className="text-amber-400/90 text-xs">
                Вагу припущено для {data.weight.assumed.length} позицій — у їхніх назвах
                немає ваги. Перевірте цифру перед відправкою.
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={save}
                disabled={saving}
                className="px-4 py-2 rounded-lg text-sm bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-200 transition-colors"
              >
                {saving ? 'Збереження...' : 'Зберегти вагу'}
              </button>
              {saved && <span className="text-emerald-400 text-xs">✓ збережено</span>}
            </div>

            <div className="border-t border-zinc-800 pt-4">
              {created || data.order.ttn ? (
                <div className="bg-emerald-950/40 border border-emerald-900/60 rounded-lg px-3 py-2.5">
                  <div className="text-emerald-300 text-sm font-medium">
                    ✓ ТТН {created?.ttn ?? data.order.ttn}
                  </div>
                  {created && (
                    <>
                      <div className="text-emerald-400/80 text-xs mt-1">
                        Вартість доставки {created.cost} грн
                        {created.estimatedDelivery && <> · орієнтовно {created.estimatedDelivery}</>}
                      </div>
                      {created.status && (
                        <div className="text-emerald-400/80 text-xs mt-0.5">
                          Статус замовлення — {created.status}
                        </div>
                      )}
                      {created.marketplaceError && (
                        <div className="text-amber-400 text-xs mt-1.5">
                          ТТН створено, але маркетплейс його не прийняв: {created.marketplaceError}.
                          Номер збережено — спробуйте передати його вручну.
                        </div>
                      )}
                    </>
                  )}
                </div>
              ) : missing.length === 0 ? (
                <button
                  onClick={createTtn}
                  disabled={creating}
                  className="w-full px-4 py-2.5 rounded-lg text-sm bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-medium transition-colors"
                >
                  {creating ? 'Створення...' : 'Створити ТТН у Новій Пошті'}
                </button>
              ) : (
                <div className="bg-amber-950/40 border border-amber-900/60 rounded-lg px-3 py-2.5">
                  <div className="text-amber-300 text-xs font-medium">
                    ТТН поки не створюється — бракує:
                  </div>
                  <ul className="mt-1.5 space-y-0.5">
                    {missing.map(k => (
                      <li key={k} className="text-amber-400/90 text-xs">· {MISSING_LABEL[k]}</li>
                    ))}
                  </ul>
                </div>
              )}
              {createError && (
                <div className="text-red-400 text-xs mt-2">{createError}</div>
              )}
              <div className="text-zinc-600 text-xs mt-2">
                Одержувача буде створено в Новій Пошті з імені та телефону
                із замовлення. Оплата — одержувачем при отриманні.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

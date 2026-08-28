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
  delivery: {
    toBranch: boolean
    /** A parcel locker: Nova Poshta refuses a waybill without dimensions */
    toPostomat: boolean
    street: string | null; building: string | null; flat: string | null
  }
  sender: { current: string | null; branches: { ref: string; description: string }[] }
  /** Nova Poshta's own locker boxes, offered instead of typing sizes */
  cells: { key: string; label: string; length: number; width: number; height: number }[]
  /** What this particular locker will take */
  limits: {
    length: number | null; width: number | null; height: number | null
    maxWeightKg: number | null; maxDeclaredCost: number | null
  } | null
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

/** Roughly to scale, so the three sizes read apart at a glance. */
function CellIcon({ size, active }: { size: string; active: boolean }) {
  const box = size === 'small' ? { w: 7, h: 7 } : size === 'medium' ? { w: 11, h: 8 } : { w: 14, h: 11 }
  return (
    <svg width="16" height="14" viewBox="0 0 16 14" className="shrink-0" aria-hidden="true">
      <rect
        x={(16 - box.w) / 2} y={(14 - box.h) / 2} width={box.w} height={box.h} rx="1"
        className={active ? 'fill-red-500/40 stroke-red-400' : 'fill-zinc-700 stroke-zinc-500'}
        strokeWidth="1"
      />
    </svg>
  )
}

/** A box fits only if every side is within the locker's own ceiling. Sides are
 *  compared largest-to-largest, since a parcel can be turned. */
function tooBigFor(
  c: { length: number; width: number; height: number },
  limits: Shipment['limits'],
): boolean {
  if (!limits?.length || !limits.width || !limits.height) return false
  const box = [c.length, c.width, c.height].sort((a, b) => b - a)
  const cell = [limits.length, limits.width, limits.height].sort((a, b) => b - a)
  return box.some((side, i) => side > cell[i])
}

/** Nova Poshta gives hundreds of branches per city, so the list is searchable
 *  and scrolls inside a fixed height rather than running off the dialog. */
function BranchPicker({ branches, value, onChange }: {
  branches: { ref: string; description: string }[]
  value: string
  onChange: (ref: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const selected = branches.find(b => b.ref === value)
  const q = query.trim().toLowerCase()
  // Typing "100" should find Відділення №100 rather than every address
  // containing those digits, so a leading number match wins
  const shown = !q ? branches : branches
    .map(b => {
      const text = b.description.toLowerCase()
      const num = /№\s*(\d+)/.exec(b.description)?.[1] ?? ''
      const score = num === q ? 0 : num.startsWith(q) ? 1 : text.includes(q) ? 2 : -1
      return { b, score }
    })
    .filter(x => x.score >= 0)
    .sort((a, b) => a.score - b.score)
    .map(x => x.b)

  return (
    <>
      <button
        type="button"
        onClick={() => { setQuery(''); setOpen(true) }}
        className="w-full flex items-center justify-between gap-2 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-left text-white text-sm hover:border-zinc-600 transition-colors"
      >
        <span className="truncate">
          {selected?.description ?? <span className="text-zinc-500">— оберіть відділення —</span>}
        </span>
        <span className="text-zinc-500 text-xs shrink-0">▼</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4"
             onClick={() => setOpen(false)}>
          <div
            className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-lg flex flex-col"
            style={{ height: 'min(70vh, 520px)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-zinc-800 shrink-0">
              <div className="flex items-center justify-between mb-2">
                <span className="text-white text-sm font-medium">Відділення відправки</span>
                <button onClick={() => setOpen(false)}
                        className="text-zinc-500 hover:text-white text-xl leading-none">×</button>
              </div>
              <input
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }}
                placeholder="Номер або адреса — напр. 100"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-red-500"
              />
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto">
              {shown.length === 0 ? (
                <div className="px-4 py-8 text-center text-zinc-600 text-sm">Нічого не знайдено</div>
              ) : shown.map(b => (
                <button
                  key={b.ref}
                  type="button"
                  onClick={() => { onChange(b.ref); setOpen(false) }}
                  className={`w-full text-left px-4 py-2.5 text-xs transition-colors border-b border-zinc-800/60 ${
                    b.ref === value
                      ? 'bg-zinc-800 text-white'
                      : 'text-zinc-300 hover:bg-zinc-800/60'
                  }`}
                >
                  {b.description}
                </button>
              ))}
            </div>

            <div className="px-4 py-2 border-t border-zinc-800 shrink-0 text-zinc-600 text-xs">
              {shown.length} із {branches.length}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/** Long enough for the marketplace to register the number before the order is
 *  marked shipped, short enough that nobody waits on it. */
const SHIP_DELAY_S = 10

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
  const [shipCountdown, setShipCountdown] = useState<number | null>(null)
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
      if (!d.ttn) return

      // The number lands and the fields lock right away; the marketplace is
      // given a moment to register it before the order is marked shipped.
      onCreated?.({ ttn: d.ttn })
      setShipCountdown(SHIP_DELAY_S)
    } catch {
      setCreateError('Помилка мережі')
    } finally {
      setCreating(false)
    }
  }

  // Counts down after a waybill is made, then moves the order to shipped
  useEffect(() => {
    if (shipCountdown == null) return
    if (shipCountdown > 0) {
      const t = setTimeout(() => setShipCountdown(n => (n ?? 1) - 1), 1000)
      return () => clearTimeout(t)
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/orders/${orderId}/ship`, { method: 'POST' })
        const d = await res.json()
        if (cancelled) return
        if (d.error) setCreateError(`ТТН збережено, але статус не змінився: ${d.error}`)
        else {
          setCreated(c => (c ? { ...c, status: d.status } : c))
          onCreated?.({ ttn: created?.ttn ?? '', status: d.status })
        }
      } finally {
        if (!cancelled) setShipCountdown(null)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipCountdown])

  const missing = data
    ? (Object.keys(data.ready) as (keyof Shipment['ready'])[]).filter(k => !data.ready[k])
    : []

  const needsDims = !!data?.delivery.toPostomat
    && !(dims.length && dims.width && dims.height)

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
                <BranchPicker
                  branches={data.sender.branches}
                  value={senderRef}
                  onChange={setSenderRef}
                />
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

            {data.cells.length > 0 && (
              <div>
                <label className="block text-zinc-400 text-xs mb-1.5">Розмір комірки</label>
                <div className="grid grid-cols-3 gap-2">
                  {data.cells.map(c => {
                    const chosen = dims.length === String(c.length)
                      && dims.width === String(c.width) && dims.height === String(c.height)
                    const overLimit = tooBigFor(c, data.limits)
                    return (
                      <button
                        key={c.key}
                        type="button"
                        disabled={overLimit}
                        onClick={() => setDims({
                          length: String(c.length), width: String(c.width), height: String(c.height),
                        })}
                        title={overLimit ? 'Не влізе в цей поштомат' : undefined}
                        className={`rounded-lg border px-2 py-2 text-left transition-colors ${
                          overLimit
                            ? 'border-zinc-800 bg-zinc-900 opacity-40 cursor-not-allowed'
                            : chosen
                              ? 'border-red-500 bg-red-950/30'
                              : 'border-zinc-700 bg-zinc-800 hover:border-zinc-600'
                        }`}
                      >
                        <span className="flex items-center gap-1.5">
                          <CellIcon size={c.key} active={chosen} />
                          <span className={`text-xs ${chosen ? 'text-white' : 'text-zinc-300'}`}>
                            {c.label}
                          </span>
                        </span>
                        <span className="block text-zinc-500 text-[11px] mt-1">
                          {c.length}×{c.width}×{c.height}
                        </span>
                      </button>
                    )
                  })}
                </div>
                {data.limits && (
                  <div className="text-zinc-600 text-xs mt-1.5">
                    Цей поштомат приймає до {data.limits.length}×{data.limits.width}×{data.limits.height} см
                    {data.limits.maxWeightKg && <> та {data.limits.maxWeightKg} кг</>}
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="block text-zinc-400 text-xs mb-1.5">
                Габарити, см{' '}
                {data.delivery.toPostomat
                  ? <span className="text-amber-400">— обовʼязково для поштомата</span>
                  : <span className="text-zinc-600">— необовʼязково</span>}
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
                {data.delivery.toPostomat
                  ? 'Нова Пошта має знати, чи посилка влізе у комірку — без габаритів ТТН не створиться.'
                  : 'Якщо не заповнити, Нова Пошта порахує обʼєм за вагою.'}
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
                      {shipCountdown != null && (
                        <div className="text-zinc-400 text-xs mt-1">
                          {shipCountdown > 0
                            ? `Статус зміниться на «На доставці» через ${shipCountdown} с`
                            : 'Переводимо в доставку…'}
                        </div>
                      )}
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
              ) : needsDims ? (
                <div className="bg-amber-950/40 border border-amber-900/60 rounded-lg px-3 py-2.5 text-amber-300 text-xs">
                  Заповніть габарити — доставка у поштомат без них неможлива.
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

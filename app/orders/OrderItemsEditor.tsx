'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

interface Line {
  id: string
  source: 'marketplace' | 'manual'
  title: string
  unit: 'кг' | 'шт'
  unit_weight: number
  marketplace_unit_price: number | null
  marketplace_qty: number | null
  ordered_total: number
  price_per_unit: number
  ordered_qty: number
  actual_qty: number | null
  removed: boolean
  corrected_total: number
}

interface Totals { ordered: number; corrected: number; diff: number }

interface Push {
  ok: boolean
  total?: number
  commission?: number
  error?: string
  skipped?: { itemId: string; wanted: number }[]
}

const money = (n: number) =>
  `₴${Number(n).toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const qty = (n: number, unit: string) =>
  unit === 'кг'
    ? `${Number(n).toLocaleString('uk-UA', { minimumFractionDigits: 0, maximumFractionDigits: 3 })} кг`
    : `${n} шт`

/** Local copy of the corrected sum so the table reacts as the operator types. */
const localCorrected = (l: Line, draft: string) => {
  if (l.removed) return 0
  const parsed = draft.trim() === '' ? null : Number(draft.replace(',', '.'))
  const q = parsed != null && Number.isFinite(parsed) ? parsed : l.ordered_qty
  return Math.round(q * l.price_per_unit * 100) / 100
}

export default function OrderItemsEditor({ orderId, onSaved }: {
  orderId: string
  onSaved?: (totals: Totals) => void
}) {
  const [lines, setLines] = useState<Line[] | null>(null)
  const [totals, setTotals] = useState<Totals | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [removed, setRemoved] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [push, setPush] = useState<Push | null>(null)
  const [picker, setPicker] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/orders/${orderId}/items`)
      const d = await res.json() as { lines?: Line[]; totals?: Totals; error?: string }
      if (d.error) { setError(d.error); return }
      setLines(d.lines ?? [])
      setTotals(d.totals ?? null)
      setDrafts(Object.fromEntries((d.lines ?? []).map(l =>
        [l.id, l.actual_qty != null ? String(l.actual_qty) : ''])))
      setRemoved(Object.fromEntries((d.lines ?? []).map(l => [l.id, l.removed])))
    } catch {
      setError('Не вдалося завантажити позиції')
    }
  }, [orderId])

  useEffect(() => { load() }, [load])

  // Recomputed live from the drafts, so the operator sees the effect immediately
  const liveTotals = useMemo(() => {
    if (!lines) return null
    const ordered = lines.filter(l => l.source === 'marketplace')
      .reduce((s, l) => s + l.ordered_total, 0)
    const corrected = lines.reduce(
      (s, l) => s + localCorrected({ ...l, removed: removed[l.id] ?? l.removed }, drafts[l.id] ?? ''), 0)
    return {
      ordered: Math.round(ordered * 100) / 100,
      corrected: Math.round(corrected * 100) / 100,
      diff: Math.round((corrected - ordered) * 100) / 100,
    }
  }, [lines, drafts, removed])

  async function save(add?: { product_id: string; qty: number }[]) {
    if (!lines) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/orders/${orderId}/items`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lines: lines.map(l => {
            const raw = (drafts[l.id] ?? '').trim().replace(',', '.')
            const parsed = raw === '' ? null : Number(raw)
            return {
              id: l.id,
              actual_qty: parsed != null && Number.isFinite(parsed) ? parsed : null,
              removed: removed[l.id] ?? l.removed,
            }
          }),
          add,
        }),
      })
      const d = await res.json() as { lines?: Line[]; totals?: Totals; push?: Push; error?: string }
      if (d.error) { setError(d.error); return }
      setLines(d.lines ?? [])
      setTotals(d.totals ?? null)
      setPush(d.push ?? null)
      setDrafts(Object.fromEntries((d.lines ?? []).map(l =>
        [l.id, l.actual_qty != null ? String(l.actual_qty) : ''])))
      setRemoved(Object.fromEntries((d.lines ?? []).map(l => [l.id, l.removed])))
      if (d.totals) onSaved?.(d.totals)
    } catch {
      setError('Не вдалося зберегти')
    } finally {
      setSaving(false)
    }
  }

  if (error && !lines) return <div className="text-red-400 text-xs">{error}</div>
  if (!lines) return <div className="text-zinc-600 text-xs">Завантаження позицій...</div>
  if (!lines.length) return <div className="text-zinc-600 text-xs">У цьому замовленні немає позицій</div>

  const t = liveTotals ?? totals
  const dirty = lines.some(l => {
    const raw = (drafts[l.id] ?? '').trim()
    const parsed = raw === '' ? null : Number(raw.replace(',', '.'))
    return parsed !== (l.actual_qty ?? null) || (removed[l.id] ?? false) !== l.removed
  })

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-zinc-500 border-b border-zinc-800">
              <th className="text-left px-2 py-2">Товар</th>
              <th className="text-right px-2 py-2 whitespace-nowrap">Ціна</th>
              <th className="text-right px-2 py-2 whitespace-nowrap">Замовлено</th>
              <th className="text-right px-2 py-2 whitespace-nowrap">Факт</th>
              <th className="text-right px-2 py-2 whitespace-nowrap">Сума замовлення</th>
              <th className="text-right px-2 py-2 whitespace-nowrap">Сума факт</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {lines.map(l => {
              const isRemoved = removed[l.id] ?? l.removed
              const corrected = localCorrected({ ...l, removed: isRemoved }, drafts[l.id] ?? '')
              const delta = corrected - l.ordered_total
              return (
                <tr key={l.id} className={isRemoved ? 'opacity-40' : ''}>
                  <td className="px-2 py-2 max-w-[280px]">
                    <div className={`text-zinc-200 ${isRemoved ? 'line-through' : ''}`}>{l.title}</div>
                    <div className="text-zinc-600 mt-0.5">
                      {l.source === 'manual' && <span className="text-cyan-500">додано вручну · </span>}
                      {l.unit === 'кг'
                        ? `${l.unit_weight} кг × ${l.marketplace_qty ?? 1} шт`
                        : 'штучний товар'}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right text-zinc-300 whitespace-nowrap">
                    {money(l.price_per_unit)}<span className="text-zinc-600">/{l.unit}</span>
                  </td>
                  <td className="px-2 py-2 text-right text-zinc-300 whitespace-nowrap">
                    {qty(l.ordered_qty, l.unit)}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <input
                      value={drafts[l.id] ?? ''}
                      disabled={isRemoved}
                      onChange={e => setDrafts(d => ({ ...d, [l.id]: e.target.value }))}
                      placeholder={String(l.ordered_qty)}
                      inputMode="decimal"
                      title={l.unit === 'кг' ? 'Фактична вага з накладної, кг' : 'Фактична кількість, шт'}
                      className="w-20 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-right text-white disabled:opacity-40 focus:outline-none focus:border-red-500"
                    />
                  </td>
                  <td className="px-2 py-2 text-right text-zinc-400 whitespace-nowrap">
                    {l.source === 'manual' ? '—' : money(l.ordered_total)}
                  </td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">
                    <span className="text-white">{money(corrected)}</span>
                    {!isRemoved && Math.abs(delta) >= 0.01 && l.source === 'marketplace' && (
                      <div className={delta > 0 ? 'text-emerald-400' : 'text-amber-400'}>
                        {delta > 0 ? '+' : ''}{money(delta)}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <button
                      onClick={() => setRemoved(r => ({ ...r, [l.id]: !isRemoved }))}
                      title={isRemoved ? 'Повернути позицію' : 'Прибрати позицію з чеку'}
                      className={`px-1.5 py-0.5 rounded transition-colors ${
                        isRemoved ? 'text-zinc-400 hover:text-white' : 'text-red-500 hover:text-red-400'
                      }`}
                    >
                      {isRemoved ? '↩' : '✕'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap border-t border-zinc-800 pt-3">
        <button
          onClick={() => setPicker(true)}
          className="px-3 py-1.5 rounded-lg text-xs bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
        >
          + Додати товар
        </button>

        {t && (
          <div className="flex items-center gap-5 text-xs">
            <span className="text-zinc-500">
              Замовлення: <span className="text-zinc-300">{money(t.ordered)}</span>
            </span>
            <span className="text-zinc-500">
              Факт: <span className="text-white font-medium">{money(t.corrected)}</span>
            </span>
            {Math.abs(t.diff) >= 0.01 && (
              <span className={t.diff > 0 ? 'text-emerald-400' : 'text-amber-400'}>
                {t.diff > 0 ? '+' : ''}{money(t.diff)}
              </span>
            )}
          </div>
        )}
      </div>

      {error && <div className="text-red-400 text-xs">{error}</div>}

      {push && (
        <div className={`rounded-lg px-3 py-2 text-xs ${
          push.ok
            ? 'bg-emerald-950/40 border border-emerald-900/60 text-emerald-300'
            : 'bg-amber-950/40 border border-amber-900/60 text-amber-300'
        }`}>
          {push.ok ? (
            <>
              ✓ Надіслано в MauDau — сума {money(push.total ?? 0)}, комісія {money(push.commission ?? 0)}
            </>
          ) : (
            <>⚠ На маркетплейс не надіслано: {push.error}</>
          )}
          {push.skipped?.length ? (
            <div className="mt-1 text-amber-400/90">
              {push.skipped.length} позицій не передано — MauDau приймає лише цілу кількість пачок,
              а фактична вага дає дробову. Ці рядки виправлені лише в нас.
            </div>
          ) : null}
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={() => save()}
          disabled={saving || !dirty}
          className="px-4 py-2 rounded-lg text-sm bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white transition-colors"
        >
          {saving ? 'Збереження...' : 'Зберегти коригування'}
        </button>
      </div>

      {picker && (
        <ProductPicker
          onClose={() => setPicker(false)}
          onPick={async (product_id, q) => {
            setPicker(false)
            await save([{ product_id, qty: q }])
          }}
        />
      )}
    </div>
  )
}

// --- catalogue lookup -------------------------------------------------------

interface Found { id: string; name: string; sku: string | null; price: number; unit: string }

function ProductPicker({ onClose, onPick }: {
  onClose: () => void
  onPick: (productId: string, qty: number) => void
}) {
  const [q, setQ] = useState('')
  const [items, setItems] = useState<Found[]>([])
  const [loading, setLoading] = useState(false)
  const [chosen, setChosen] = useState<Found | null>(null)
  const [amount, setAmount] = useState('1')

  useEffect(() => {
    let alive = true
    setLoading(true)
    const t = setTimeout(() => {
      fetch(`/api/products/search?q=${encodeURIComponent(q)}`)
        .then(r => r.json())
        .then((d: { products?: Found[] }) => alive && setItems(d.products ?? []))
        .catch(() => {})
        .finally(() => alive && setLoading(false))
    }, 250)
    return () => { alive = false; clearTimeout(t) }
  }, [q])

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-start justify-center p-4" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-lg my-16"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
          <span className="text-white text-sm font-medium">Додати товар</span>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-xl leading-none">×</button>
        </div>

        <div className="p-4 space-y-3">
          <input
            autoFocus
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Пошук за назвою або артикулом..."
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-red-500"
          />

          <div className="max-h-64 overflow-y-auto divide-y divide-zinc-800/60 border border-zinc-800 rounded-lg">
            {loading && <div className="px-3 py-3 text-zinc-600 text-xs">Пошук...</div>}
            {!loading && items.length === 0 && (
              <div className="px-3 py-3 text-zinc-600 text-xs">Нічого не знайдено</div>
            )}
            {items.map(p => (
              <button
                key={p.id}
                onClick={() => setChosen(p)}
                className={`w-full text-left px-3 py-2 hover:bg-zinc-800/60 transition-colors ${
                  chosen?.id === p.id ? 'bg-zinc-800' : ''
                }`}
              >
                <div className="text-zinc-200 text-xs">{p.name}</div>
                <div className="text-zinc-600 text-xs mt-0.5">
                  {p.sku && <>{p.sku} · </>}{money(p.price)}/{p.unit}
                </div>
              </button>
            ))}
          </div>

          {chosen && (
            <div className="flex items-end gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-zinc-500 text-xs mb-1">
                  Скільки {chosen.unit === 'кг' ? '(кг)' : '(шт)'}
                </div>
                <input
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  inputMode="decimal"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-red-500"
                />
              </div>
              <button
                onClick={() => {
                  const n = Number(amount.replace(',', '.'))
                  if (Number.isFinite(n) && n > 0) onPick(chosen.id, n)
                }}
                className="px-4 py-2 rounded-lg text-sm bg-red-600 hover:bg-red-500 text-white transition-colors"
              >
                Додати
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

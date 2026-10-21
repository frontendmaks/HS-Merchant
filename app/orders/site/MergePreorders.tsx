'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { SLOTS } from '@/lib/delivery-slots'

export interface Candidate {
  id: string
  external_id: string | null
  customer_name: string | null
  customer_phone: string | null
  address: string | null
  warehouse: string | null
  total: number | null
}

const money = (n: number | null) =>
  `${Math.round(Number(n) || 0).toLocaleString('uk-UA')} ₴`

/**
 * Об'єднання передзамовлень.
 *
 * Сайт дозволяє покупцеві взяти лише одну позицію за раз, тож одна людина
 * лишає кілька замовлень на одну адресу. Складу це чотири ящики замість
 * одного.
 *
 * Обирати можна лише в межах одного телефону: ім'я в таких замовленнях
 * буває різне, бо його вписують щоразу наново, а телефон той самий — і
 * саме він каже, кому везти.
 */
export default function MergePreorders({ candidates, date }: {
  candidates: Candidate[]
  date: string
}) {
  const router = useRouter()
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [slot, setSlot] = useState(SLOTS[0].label)
  const [when, setWhen] = useState(date)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!candidates.length) return null

  const chosen = candidates.filter(c => picked.has(c.id))
  const phones = new Set(chosen.map(c => (c.customer_phone ?? '').replace(/\D/g, '').slice(-9)))
  const mixed = phones.size > 1

  const toggle = (id: string) => setPicked(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  async function merge() {
    setBusy(true)
    setError(null)
    try {
      const r = await fetch('/api/orders/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderIds: [...picked], deliveryDate: when, deliverySlot: slot,
        }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? 'Не вдалося об’єднати')
      setPicked(new Set())
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-300">
          Об&apos;єднати передзамовлення
        </h2>
        <p className="text-zinc-500 text-xs mt-0.5">
          Оберіть замовлення одного покупця — вони стануть одним, з однією
          доставкою й одним бланком
        </p>
      </div>

      <div className="divide-y divide-zinc-800/60">
        {candidates.map(c => {
          const on = picked.has(c.id)
          return (
            <label
              key={c.id}
              className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer text-sm
                          transition-colors ${on ? 'bg-zinc-800/60' : 'hover:bg-zinc-800/30'}`}
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() => toggle(c.id)}
                className="accent-red-500"
              />
              <span className="text-zinc-500 w-28 shrink-0">{c.external_id}</span>
              <span className="text-white w-32 shrink-0 truncate">{c.customer_name}</span>
              <span className="text-zinc-400 w-32 shrink-0">{c.customer_phone}</span>
              <span className="text-zinc-400 flex-1 min-w-0 truncate">{c.address}</span>
              <span className="text-zinc-300 tabular-nums">{money(c.total)}</span>
            </label>
          )
        })}
      </div>

      {picked.size > 0 && (
        <div className="px-4 py-3 border-t border-zinc-800 flex flex-wrap items-center gap-2">
          <span className="text-zinc-400 text-xs">
            Обрано {picked.size} ·{' '}
            {money(chosen.reduce((s, c) => s + Number(c.total ?? 0), 0))}
          </span>

          <input
            type="date" value={when} onChange={e => setWhen(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5
                       text-white text-xs focus:outline-none focus:border-red-500"
          />
          <select
            value={slot} onChange={e => setSlot(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5
                       text-white text-xs focus:outline-none focus:border-red-500"
          >
            {SLOTS.map(s => <option key={s.label} value={s.label}>{s.label}</option>)}
          </select>

          <button
            onClick={() => void merge()}
            disabled={busy || picked.size < 2 || mixed}
            className="bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white
                       text-xs px-3 py-1.5 rounded-lg transition-colors"
          >
            {busy ? 'Об’єдную…' : `Об’єднати ${picked.size}`}
          </button>

          {mixed && (
            <span className="text-amber-400 text-xs">
              Обрані замовлення від різних телефонів — об&apos;єднати не можна
            </span>
          )}
          {!mixed && picked.size < 2 && (
            <span className="text-zinc-600 text-xs">Потрібно щонайменше два</span>
          )}
        </div>
      )}

      {error && (
        <div className="px-4 py-2 bg-amber-950/40 border-t border-amber-900
                        text-amber-400 text-xs">
          {error}
        </div>
      )}
    </div>
  )
}

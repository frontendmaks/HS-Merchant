'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export interface Card {
  key: string
  title: string
  what: string
  managed: 'env' | 'panel'
  fields: { name: string; label: string; hint?: string; secret?: boolean }[]
  connected: boolean
  status: string | null
  checkedAt: string | null
  masked: string | null
}

export default function IntegrationCard({ card, extra }: { card: Card; extra: string | null }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send(action: 'connect' | 'disconnect') {
    setBusy(true)
    setError(null)
    try {
      const r = await fetch(`/api/integrations/${card.key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, config: values }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? 'Не вдалося')
      if (d.warning) setError(d.warning)
      else { setOpen(false); setValues({}) }
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-white font-semibold text-sm">{card.title}</h2>
            <span className={`text-[11px] px-1.5 py-0.5 rounded ${
              card.connected ? 'bg-emerald-950 text-emerald-400' : 'bg-zinc-800 text-zinc-500'
            }`}>
              {card.connected ? 'під’єднано' : 'не під’єднано'}
            </span>
          </div>
          <p className="text-zinc-500 text-xs mt-1">{card.what}</p>
        </div>

        {card.managed === 'panel' && (
          card.connected ? (
            <button
              onClick={() => void send('disconnect')}
              disabled={busy}
              className="shrink-0 px-2.5 py-1.5 rounded-lg text-xs bg-zinc-800
                         text-zinc-400 hover:text-white transition-colors"
            >
              Вимкнути
            </button>
          ) : (
            <button
              onClick={() => setOpen(v => !v)}
              className="shrink-0 px-2.5 py-1.5 rounded-lg text-xs bg-red-600
                         text-white hover:bg-red-500 transition-colors"
            >
              Під&apos;єднати
            </button>
          )
        )}
      </div>

      {card.status && (
        <div className="mt-2 text-xs text-zinc-400">{card.status}</div>
      )}
      {card.masked && (
        <div className="mt-1 text-xs text-zinc-600">Токен: {card.masked}</div>
      )}
      {extra && <div className="mt-1 text-xs text-zinc-500">{extra}</div>}

      {/* Поля показуємо лише коли під'єднують: токен, що лежить на екрані
          без потреби, рано чи пізно потрапить на чийсь скріншот */}
      {open && card.managed === 'panel' && (
        <div className="mt-3 space-y-2 border-t border-zinc-800 pt-3">
          {card.fields.map(f => (
            <div key={f.name}>
              <label className="block text-zinc-400 text-xs mb-1">{f.label}</label>
              <input
                type={f.secret ? 'password' : 'text'}
                value={values[f.name] ?? ''}
                onChange={e => setValues(v => ({ ...v, [f.name]: e.target.value }))}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5
                           text-white text-xs focus:outline-none focus:border-red-500"
              />
              {f.hint && <p className="text-zinc-600 text-[11px] mt-1">{f.hint}</p>}
            </div>
          ))}
          <button
            onClick={() => void send('connect')}
            disabled={busy}
            className="bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white
                       text-xs px-3 py-1.5 rounded-lg transition-colors"
          >
            {busy ? 'Перевіряю…' : 'Перевірити й увімкнути'}
          </button>
        </div>
      )}

      {error && (
        <div className="mt-2 bg-amber-950/40 border border-amber-900 rounded-lg
                        px-2.5 py-1.5 text-amber-400 text-xs">
          {error}
        </div>
      )}
    </div>
  )
}

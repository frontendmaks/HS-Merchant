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
  /** Токен збережено, але зв'язок вимкнено — увімкнути можна одним рухом */
  dormant: boolean
  status: string | null
  checkedAt: string | null
  masked: string | null
}

type Action = 'connect' | 'disconnect' | 'forget' | 'check'

export default function IntegrationCard({ card, extra }: { card: Card; extra: string | null }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<Action | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function send(action: Action) {
    /*
     * Відключення акаунта незворотне для токена: його доведеться шукати
     * заново. Тому питаємо — на відміну від «вимкнути», де нічого не
     * втрачається.
     */
    if (action === 'forget'
      && !confirm(`Відключити акаунт ${card.title}? Токен буде стерто, і його доведеться вставити заново.`)) {
      return
    }

    setBusy(action)
    setError(null)
    setDone(null)
    try {
      const r = await fetch(`/api/integrations/${card.key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, config: values }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? 'Не вдалося')

      if (d.warning) setError(d.warning)
      else {
        setOpen(false)
        setValues({})
        if (action === 'check') setDone(d.who ? `Відповів: ${d.who}` : 'Працює')
      }
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const button = 'px-2.5 py-1.5 rounded-lg text-xs transition-colors disabled:opacity-50'
  const quiet = `${button} bg-zinc-800 text-zinc-400 hover:text-white`

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-white font-semibold text-sm">{card.title}</h2>
            <span className={`text-[11px] px-1.5 py-0.5 rounded ${
              card.connected ? 'bg-emerald-950 text-emerald-400'
                : card.dormant ? 'bg-amber-950 text-amber-400'
                : 'bg-zinc-800 text-zinc-500'
            }`}>
              {card.connected ? 'під’єднано'
                : card.dormant ? 'вимкнено'
                : 'не під’єднано'}
            </span>
          </div>
          <p className="text-zinc-500 text-xs mt-1">{card.what}</p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={() => void send('check')} disabled={!!busy} className={quiet}>
            {busy === 'check' ? '…' : 'Перевірити'}
          </button>

          {card.managed === 'panel' && (
            card.connected || card.dormant ? (
              <button onClick={() => setOpen(v => !v)} className={quiet}>
                Змінити акаунт
              </button>
            ) : (
              <button
                onClick={() => setOpen(v => !v)}
                className={`${button} bg-red-600 text-white hover:bg-red-500`}
              >
                Під&apos;єднати
              </button>
            )
          )}
        </div>
      </div>

      {card.status && <div className="mt-2 text-xs text-zinc-400">{card.status}</div>}
      {card.masked && <div className="mt-1 text-xs text-zinc-600">Токен: {card.masked}</div>}
      {extra && <div className="mt-1 text-xs text-zinc-500">{extra}</div>}
      {card.checkedAt && (
        <div className="mt-1 text-xs text-zinc-600">
          Перевірено {new Date(card.checkedAt).toLocaleString('uk-UA')}
        </div>
      )}

      {card.managed === 'panel' && (card.connected || card.dormant) && (
        <div className="flex flex-wrap items-center gap-1.5 mt-3">
          {card.connected ? (
            <button onClick={() => void send('disconnect')} disabled={!!busy} className={quiet}>
              Вимкнути
            </button>
          ) : (
            <button
              onClick={() => void send('connect')}
              disabled={!!busy}
              className={`${button} bg-emerald-800 text-white hover:bg-emerald-700`}
            >
              Увімкнути знову
            </button>
          )}
          <button
            onClick={() => void send('forget')}
            disabled={!!busy}
            className={`${button} bg-zinc-800 text-red-400 hover:bg-red-950 hover:text-red-300`}
          >
            Відключити акаунт
          </button>
        </div>
      )}

      {/* Поля показуємо лише коли щось міняють: токен, що лежить на екрані
          без потреби, рано чи пізно потрапить на чийсь скріншот */}
      {open && card.managed === 'panel' && (
        <div className="mt-3 space-y-2 border-t border-zinc-800 pt-3">
          {card.masked && (
            <p className="text-zinc-500 text-[11px]">
              Новий токен замінить теперішній. Порожнє поле лишить як є.
            </p>
          )}
          {card.fields.map(f => (
            <div key={f.name}>
              <label className="block text-zinc-400 text-xs mb-1">{f.label}</label>
              <input
                type={f.secret ? 'password' : 'text'}
                value={values[f.name] ?? ''}
                onChange={e => setValues(v => ({ ...v, [f.name]: e.target.value }))}
                autoComplete="off"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5
                           text-white text-xs focus:outline-none focus:border-red-500"
              />
              {f.hint && <p className="text-zinc-600 text-[11px] mt-1">{f.hint}</p>}
            </div>
          ))}
          <div className="flex gap-1.5">
            <button
              onClick={() => void send('connect')}
              disabled={!!busy}
              className={`${button} bg-red-600 text-white hover:bg-red-500`}
            >
              {busy === 'connect' ? 'Перевіряю…' : 'Перевірити й увімкнути'}
            </button>
            <button onClick={() => { setOpen(false); setValues({}) }} className={quiet}>
              Скасувати
            </button>
          </div>
        </div>
      )}

      {done && <div className="mt-2 text-emerald-500 text-xs">{done}</div>}
      {error && (
        <div className="mt-2 bg-amber-950/40 border border-amber-900 rounded-lg
                        px-2.5 py-1.5 text-amber-400 text-xs">
          {error}
        </div>
      )}
    </div>
  )
}

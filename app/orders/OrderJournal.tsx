'use client'

import { useEffect, useState } from 'react'

interface LineChange {
  title: string
  unit: string
  kind: 'added' | 'removed' | 'restored' | 'qty'
  from: number | null
  to: number
  sum_from: number
  sum_to: number
}

interface EventDetails {
  changes?: LineChange[]
  totals?: { ordered: number; corrected: number; diff: number }
  push?: { ok: boolean; total?: number; commission?: number; error?: string } | null
}

export interface OrderEvent {
  id: string
  type: string
  old_value: string | null
  new_value: string | null
  details: EventDetails | null
  created_at: string
  actor_id: string | null
  actor_name: string | null
}

const money = (n: number) =>
  `₴${Number(n).toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const amount = (n: number | null, unit: string) =>
  n == null ? '—' : `${Number(n).toLocaleString('uk-UA', { maximumFractionDigits: 3 })} ${unit}`

const KIND_LABEL: Record<LineChange['kind'], string> = {
  added: 'додано', removed: 'прибрано', restored: 'повернуто', qty: '',
}

/** The per-line breakdown behind a correction, folded away until asked for. */
function ChangeDetails({ details }: { details: EventDetails }) {
  const [open, setOpen] = useState(false)
  const changes = details.changes ?? []
  if (!changes.length && !details.push) return null

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="text-zinc-500 hover:text-zinc-300 text-xs transition-colors"
      >
        {open ? '▾' : '▸'} {changes.length ? `${changes.length} позицій` : 'деталі'}
      </button>

      {open && (
        <div className="mt-1.5 space-y-1.5 border-l border-zinc-800 pl-2.5">
          {changes.map((c, i) => (
            <div key={i} className="text-xs">
              <div className="text-zinc-300">
                {c.title}
                {KIND_LABEL[c.kind] && (
                  <span className="text-zinc-500"> · {KIND_LABEL[c.kind]}</span>
                )}
              </div>
              <div className="text-zinc-500">
                {amount(c.from, c.unit)} → <span className="text-zinc-300">{amount(c.to, c.unit)}</span>
                {'  ·  '}
                {money(c.sum_from)} → <span className="text-zinc-300">{money(c.sum_to)}</span>
              </div>
            </div>
          ))}

          {details.totals && (
            <div className="text-xs text-zinc-400 pt-1 border-t border-zinc-800/60">
              Разом: {money(details.totals.ordered)} → <span className="text-white">{money(details.totals.corrected)}</span>
              {Math.abs(details.totals.diff) >= 0.01 && (
                <span className={details.totals.diff > 0 ? ' text-emerald-400' : ' text-amber-400'}>
                  {' '}({details.totals.diff > 0 ? '+' : ''}{money(details.totals.diff)})
                </span>
              )}
            </div>
          )}

          {details.push && (
            <div className={`text-xs ${details.push.ok ? 'text-emerald-400' : 'text-amber-400'}`}>
              {details.push.ok
                ? `Маркетплейс: сума ${money(details.push.total ?? 0)}, комісія ${money(details.push.commission ?? 0)}`
                : `На маркетплейс не надіслано: ${details.push.error}`}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const EVENT_META: Record<string, { label: string; icon: string; tone: string }> = {
  created:       { label: 'замовлення надійшло',        icon: '✚', tone: 'text-emerald-400' },
  status:        { label: 'змінив статус',              icon: '↻', tone: 'text-blue-400' },
  ttn:           { label: 'вказав ТТН',                 icon: '▤', tone: 'text-zinc-400' },
  cancel:        { label: 'скасував замовлення',        icon: '✕', tone: 'text-red-400' },
  cancel_reason: { label: 'вказав причину скасування',  icon: '✎', tone: 'text-amber-400' },
  sync_status:   { label: 'статус змінив маркетплейс',  icon: '⇄', tone: 'text-purple-400' },
  items:         { label: 'скоригував склад замовлення', icon: '≡', tone: 'text-cyan-400' },
  marketplace_push: { label: 'надіслав зміни на маркетплейс', icon: '⇪', tone: 'text-purple-300' },
}

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString('uk-UA', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })

/** Gap between two events, so the reader sees how long each step took. */
function gapLabel(fromIso: string, toIso: string): string | null {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime()
  if (ms < 60_000) return null
  const mins = Math.round(ms / 60_000)
  if (mins < 60) return `${mins} хв`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours} год`
  return `${Math.round(hours / 24)} дн`
}

export default function OrderJournal({ orderId }: { orderId: string }) {
  const [events, setEvents] = useState<OrderEvent[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    fetch(`/api/orders/${orderId}/events`)
      .then(r => r.json())
      .then((d: { events?: OrderEvent[]; error?: string }) => {
        if (!alive) return
        if (d.error) setError(d.error)
        else setEvents(d.events ?? [])
      })
      .catch(() => alive && setError('Не вдалося завантажити журнал'))
    return () => { alive = false }
  }, [orderId])

  if (error) return <div className="text-red-400 text-xs">{error}</div>
  if (!events) return <div className="text-zinc-600 text-xs">Завантаження...</div>

  if (events.length === 0) {
    return (
      <div className="text-zinc-600 text-xs">
        Записів ще немає. Журнал наповнюється з моменту, коли хтось змінить
        статус, ТТН або скасує замовлення.
      </div>
    )
  }

  return (
    <div className="relative pl-5">
      {/* timeline spine */}
      <div className="absolute left-[7px] top-1.5 bottom-1.5 w-px bg-zinc-800" />

      <div className="space-y-3">
        {events.map((e, i) => {
          const meta = EVENT_META[e.type] ?? { label: e.type, icon: '•', tone: 'text-zinc-400' }
          const actor = e.actor_name?.trim() || (e.actor_id ? 'Користувач' : 'Синхронізація')
          const gap = i > 0 ? gapLabel(events[i - 1].created_at, e.created_at) : null

          return (
            <div key={e.id} className="relative">
              <span className={`absolute -left-5 top-0.5 text-xs ${meta.tone}`}>{meta.icon}</span>

              <div className="text-xs">
                <span className="text-zinc-200">{actor}</span>{' '}
                <span className="text-zinc-500">{meta.label}</span>
              </div>

              {(e.old_value || e.new_value) && (
                <div className="text-xs mt-0.5 break-words">
                  {e.old_value && <span className="text-zinc-600 line-through">{e.old_value}</span>}
                  {e.old_value && e.new_value && <span className="text-zinc-600"> → </span>}
                  {e.new_value && <span className="text-zinc-300">{e.new_value}</span>}
                </div>
              )}

              {e.details && <ChangeDetails details={e.details} />}

              <div className="text-zinc-600 text-xs mt-0.5">
                {fmtTime(e.created_at)}
                {gap && <span className="text-zinc-700"> · через {gap}</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

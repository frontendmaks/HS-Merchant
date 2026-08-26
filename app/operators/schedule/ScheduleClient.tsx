'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ACTION_LABELS, EVENT_LABELS, PHASE_LABELS, PHASE_TONES, STATUS_LABELS,
  STATUS_TONES, WEEKDAYS, actionsFor, canApprove, canParticipate, dayLabel,
  holdsPen, isInNegotiation, isOverdue, isPlannable, kyivToday,
  maxPlannableWeek, nextWeekStart, thisWeekStart, weekDates, weekLabel,
  weekPhase, weekStartOf,
  type ScheduleAction, type ScheduleStatus,
} from '@/lib/schedule'
import { timeAgo } from '@/lib/format'

interface Operator { id: string; full_name: string | null; email: string }
interface Shift { operator_id: string; work_date: string }
interface Swap {
  id: string; work_date: string; from_operator: string; to_operator: string
  reason: string | null; status: string
  peer_ok_at: string | null; manager_ok_at: string | null; created_at: string
}
interface Schedule {
  id: string; week_start: string; status: ScheduleStatus
  submitted_at: string | null; approved_at: string | null
}
interface EventRow {
  id: string; type: string; created_at: string
  details: { added?: string[]; removed?: string[] } | null
  actor: { full_name: string | null; email: string } | null
}
interface Week {
  schedule: Schedule; shifts: Shift[]; swaps: Swap[]
  operators: Operator[]; events: EventRow[]
}

/** One colour per operator, so a glance at a column says who is on. */
const TONES = [
  { chip: 'bg-sky-500/80',     cell: 'bg-sky-500/25 hover:bg-sky-500/40',        ring: 'ring-sky-400/60' },
  { chip: 'bg-amber-400/90',   cell: 'bg-amber-400/25 hover:bg-amber-400/40',    ring: 'ring-amber-300/60' },
  { chip: 'bg-emerald-500/80', cell: 'bg-emerald-500/25 hover:bg-emerald-500/40', ring: 'ring-emerald-400/60' },
  { chip: 'bg-violet-500/80',  cell: 'bg-violet-500/25 hover:bg-violet-500/40',  ring: 'ring-violet-400/60' },
  { chip: 'bg-rose-500/80',    cell: 'bg-rose-500/25 hover:bg-rose-500/40',      ring: 'ring-rose-400/60' },
  { chip: 'bg-teal-500/80',    cell: 'bg-teal-500/25 hover:bg-teal-500/40',      ring: 'ring-teal-400/60' },
]

const nameOf = (o: Operator | undefined) => (o ? o.full_name || o.email : '—')
const actorName = (a: EventRow['actor']) => a?.full_name || a?.email || 'Хтось'

const ACTION_STYLE: Record<ScheduleAction, string> = {
  submit: 'bg-red-600 hover:bg-red-500 text-white font-medium',
  approve: 'bg-emerald-700 hover:bg-emerald-600 text-white font-medium',
  agree: 'bg-emerald-700 hover:bg-emerald-600 text-white font-medium',
  amend: 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200',
  send_back: 'bg-red-600 hover:bg-red-500 text-white font-medium',
}

export default function ScheduleClient({ initialWeek, role, meId }: {
  initialWeek: string
  role: string
  meId: string
}) {
  const [week, setWeek] = useState(initialWeek)
  const [data, setData] = useState<Week | null>(null)
  // Weeks already fetched, so going back to one is instant
  const [cache, setCache] = useState<Record<string, Week>>({})
  const [marks, setMarks] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [swapFor, setSwapFor] = useState<string | null>(null)
  const [journalOpen, setJournalOpen] = useState(false)

  const days = useMemo(() => weekDates(week), [week])
  const today = kyivToday()
  const participates = canParticipate(role)
  const manages = canApprove(role)
  const plannable = isPlannable(week)
  const status = data?.schedule.status ?? 'draft'
  const phase = weekPhase(week, status)

  const applyWeek = useCallback((w: Week) => {
    setData(w)
    setMarks(new Set(w.shifts.map(s => `${s.operator_id}|${s.work_date}`)))
    setDirty(false)
  }, [])

  const load = useCallback(async (target: string, { fresh = false } = {}) => {
    const cached = cache[target]
    // Show what we already have at once, refresh behind it
    if (cached && !fresh) { applyWeek(cached); setLoading(false) }
    else setLoading(true)

    setError('')
    try {
      const res = await fetch(`/api/schedule?week=${target}`)
      const d = await res.json()
      if (d.error) { setError(d.error); return }
      setCache(c => ({ ...c, [target]: d }))
      applyWeek(d)
    } catch {
      setError('Не вдалося завантажити графік')
    } finally {
      setLoading(false)
    }
  }, [cache, applyWeek])

  useEffect(() => { void load(week) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [week])

  /** Switching weeks stays inside the page — a navigation would re-render the
   *  whole route on the server for data this component fetches anyway. */
  function goto(target: string) {
    const w = weekStartOf(target)
    setWeek(w)
    const q = new URLSearchParams({ week: w })
    window.history.replaceState(null, '', `/operators/schedule?${q}`)
  }

  const key = (op: string, date: string) => `${op}|${date}`
  const editable = participates && plannable && holdsPen(status, role)
  const actions = actionsFor(status, role, participates && plannable)

  function toggle(op: string, date: string) {
    if (!editable) return
    setMarks(prev => {
      const next = new Set(prev)
      const k = key(op, date)
      if (next.has(k)) next.delete(k); else next.add(k)
      return next
    })
    setDirty(true)
  }

  async function save(): Promise<boolean> {
    const shifts = [...marks].map(k => {
      const [operator_id, work_date] = k.split('|')
      return { operator_id, work_date }
    })
    const res = await fetch('/api/schedule', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ week, shifts }),
    })
    const d = await res.json()
    if (d.error) { setError(d.error); return false }
    setDirty(false)
    return true
  }

  async function act(action: ScheduleAction) {
    setBusy(true)
    setError('')
    try {
      if (dirty && !(await save())) return
      const res = await fetch('/api/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week, action }),
      })
      const d = await res.json()
      if (d.error) { setError(d.error); return }
      await load(week, { fresh: true })
    } finally {
      setBusy(false)
    }
  }

  const operators = data?.operators ?? []
  const swaps = data?.swaps ?? []
  const pending = swaps.filter(s => s.status === 'pending')
  const nextWeek = nextWeekStart()
  const maxWeek = maxPlannableWeek()

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">Графік роботи</h1>
          <p className="text-zinc-400 text-sm mt-0.5">
            {weekLabel(week)}
            {data && (
              <>
                {/* Where the week sits in its life… */}
                <span className={`ml-2 text-xs px-2 py-0.5 rounded ${PHASE_TONES[phase]}`}>
                  {PHASE_LABELS[phase]}
                </span>
                {/* …and, only while it is genuinely being passed back and
                    forth, whose turn it is */}
                {isInNegotiation(status) && (
                  <span className={`ml-1.5 text-xs px-2 py-0.5 rounded ${STATUS_TONES[status]}`}>
                    {STATUS_LABELS[status]}
                  </span>
                )}
              </>
            )}
            {loading && <span className="ml-2 text-zinc-600 text-xs">оновлення…</span>}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => goto(thisWeekStart())}
            className={`px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
              week === thisWeekStart() ? 'bg-zinc-700 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-white'
            }`}
          >
            Поточний
          </button>
          <button
            onClick={() => goto(nextWeek)}
            className={`px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
              week === nextWeek ? 'bg-zinc-700 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-white'
            }`}
          >
            Наступний
          </button>

          {/* Any past week is one date away; planning stops at next week */}
          <label className="flex items-center gap-2 bg-zinc-800 rounded-lg px-2.5 py-1">
            <span className="text-zinc-500 text-xs">Тиждень</span>
            <input
              type="date"
              value={week}
              max={maxWeek}
              onChange={e => e.target.value && goto(e.target.value)}
              onClick={e => { try { e.currentTarget.showPicker?.() } catch { /* needs a gesture */ } }}
              className="bg-transparent text-white text-xs focus:outline-none cursor-pointer [color-scheme:dark]"
            />
          </label>
        </div>
      </div>

      {participates && isOverdue() && week !== nextWeek && (
        <div className="bg-amber-950/40 border border-amber-900/60 rounded-xl px-4 py-3">
          <div className="text-amber-300 text-sm">Дедлайн на наступний тиждень — сьогодні до 16:00</div>
          <button onClick={() => goto(nextWeek)}
            className="text-amber-400 hover:text-amber-300 text-xs mt-1 underline underline-offset-2">
            Перейти до {weekLabel(nextWeek)}
          </button>
        </div>
      )}

      {error && (
        <div className="bg-red-950/40 border border-red-900/60 rounded-xl px-4 py-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        {!data && loading ? (
          <div className="px-5 py-10 text-center text-zinc-600 text-sm">Завантаження...</div>
        ) : operators.length === 0 ? (
          <div className="px-5 py-10 text-center text-zinc-500 text-sm">
            Немає жодного користувача з роллю Оператор.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-zinc-900 text-left px-4 py-2.5 border-b border-zinc-800 min-w-[150px]">
                    <span className="text-zinc-500 text-xs">Оператор</span>
                  </th>
                  {days.map((d, i) => (
                    <th key={d} className={`px-2 py-2.5 border-b border-zinc-800 text-center min-w-[92px] ${
                      d === today ? 'bg-zinc-800/60' : ''
                    }`}>
                      <div className={`text-xs ${d === today ? 'text-white font-medium' : 'text-zinc-400'}`}>
                        {WEEKDAYS[i]}
                      </div>
                      <div className={`text-xs mt-0.5 ${d === today ? 'text-zinc-300' : 'text-zinc-600'}`}>
                        {dayLabel(d)}
                      </div>
                    </th>
                  ))}
                  <th className="px-3 py-2.5 border-b border-zinc-800 text-center">
                    <span className="text-zinc-500 text-xs">Разом</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {operators.map((op, i) => {
                  const tone = TONES[i % TONES.length]
                  const count = days.filter(d => marks.has(key(op.id, d))).length
                  return (
                    <tr key={op.id}>
                      <td className="sticky left-0 z-10 bg-zinc-900 px-4 py-2 border-b border-zinc-800/60">
                        <div className="flex items-center gap-2">
                          <span className={`w-2.5 h-2.5 rounded-sm shrink-0 ${tone.chip}`} />
                          <span className="text-zinc-200 text-xs truncate">
                            {nameOf(op)}
                            {op.id === meId && <span className="text-zinc-600"> (ви)</span>}
                          </span>
                        </div>
                      </td>
                      {days.map(d => {
                        const on = marks.has(key(op.id, d))
                        const swapPending = pending.some(s =>
                          s.work_date === d && (s.from_operator === op.id || s.to_operator === op.id))
                        return (
                          <td key={d} className={`p-1 border-b border-zinc-800/60 ${d === today ? 'bg-zinc-800/30' : ''}`}>
                            <button
                              type="button"
                              onClick={() => toggle(op.id, d)}
                              disabled={!editable}
                              title={editable ? (on ? 'Прибрати зміну' : 'Поставити зміну') : undefined}
                              className={`w-full h-9 rounded-md transition-colors relative ${
                                on
                                  ? `${tone.cell} ${swapPending ? `ring-2 ${tone.ring}` : ''}`
                                  : editable ? 'bg-zinc-800/40 hover:bg-zinc-800' : 'bg-zinc-800/20'
                              } ${editable ? 'cursor-pointer' : 'cursor-default'}`}
                            >
                              {swapPending && (
                                <span className="absolute top-0.5 right-1 text-[9px] text-amber-300">↔</span>
                              )}
                            </button>
                          </td>
                        )
                      })}
                      <td className="px-3 py-2 border-b border-zinc-800/60 text-center">
                        <span className={`text-xs ${count ? 'text-zinc-300' : 'text-zinc-700'}`}>{count}</span>
                      </td>
                    </tr>
                  )
                })}

                {/* An uncovered day is the thing a manager is actually scanning for */}
                <tr>
                  <td className="sticky left-0 z-10 bg-zinc-900 px-4 py-2">
                    <span className="text-zinc-500 text-xs">На зміні</span>
                  </td>
                  {days.map(d => {
                    const n = operators.filter(o => marks.has(key(o.id, d))).length
                    return (
                      <td key={d} className={`px-2 py-2 text-center ${d === today ? 'bg-zinc-800/30' : ''}`}>
                        <span className={`text-xs ${n === 0 ? 'text-red-400 font-medium' : 'text-zinc-400'}`}>
                          {n === 0 ? 'нікого' : n}
                        </span>
                      </td>
                    )
                  })}
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {data && operators.length > 0 && (
          <div className="px-4 py-3 border-t border-zinc-800 flex items-center gap-3 flex-wrap">
            {/* People who do not take part get no buttons at all — not greyed
                ones, none — so the grid reads as what it is to them: a notice */}
            {actions.map(a => (
              <button
                key={a}
                onClick={() => act(a)}
                disabled={busy}
                className={`px-3.5 py-1.5 rounded-lg text-xs transition-colors disabled:opacity-40 ${ACTION_STYLE[a]}`}
              >
                {busy ? '...' : ACTION_LABELS[a]}
              </button>
            ))}

            {editable && dirty && (
              <span className="text-amber-400/80 text-xs">є незбережені зміни</span>
            )}

            {role === 'operator' && plannable && status === 'approved' && (
              <button
                onClick={() => setSwapFor(days.find(d => marks.has(key(meId, d))) ?? days[0])}
                className="px-3.5 py-1.5 rounded-lg text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
              >
                Попросити заміну
              </button>
            )}

            <button
              onClick={() => setJournalOpen(o => !o)}
              className="px-3 py-1.5 rounded-lg text-xs bg-zinc-800/60 hover:bg-zinc-800 text-zinc-400 transition-colors ml-auto"
            >
              Журнал {data.events.length > 0 && `· ${data.events.length}`}
            </button>

            <span className="text-zinc-600 text-xs">
              {!participates
                ? 'Перегляд'
                : !plannable
                  ? 'Архів — лише перегляд'
                  : data.schedule.approved_at
                    ? `Затверджено ${timeAgo(data.schedule.approved_at)}`
                    : 'Дедлайн — пʼятниця до 16:00'}
            </span>
          </div>
        )}

        {journalOpen && data && (
          <Journal week={week} events={data.events} operators={operators} />
        )}
      </div>

      {swaps.length > 0 && (
        <SwapList
          swaps={swaps} operators={operators} meId={meId} manages={manages}
          onChanged={() => void load(week, { fresh: true })}
        />
      )}

      {swapFor && (
        <SwapDialog
          days={days}
          myDays={days.filter(d => marks.has(key(meId, d)))}
          operators={operators.filter(o => o.id !== meId)}
          initialDate={swapFor}
          onClose={() => setSwapFor(null)}
          onDone={() => { setSwapFor(null); void load(week, { fresh: true }) }}
        />
      )}
    </div>
  )
}

/** How this week got to where it is: every handover and every edit. Belongs to
 *  the week on screen, and is refetched with it. */
function Journal({ week, events, operators }: {
  week: string; events: EventRow[]; operators: Operator[]
}) {
  const byId = new Map(operators.map(o => [o.id, o]))
  const describe = (k: string) => {
    const [op, date] = k.split('|')
    return `${nameOf(byId.get(op))} ${dayLabel(date)}`
  }

  return (
    <div className="border-t border-zinc-800">
      <div className="px-5 py-2.5 bg-zinc-800/30 border-b border-zinc-800/60">
        <span className="text-zinc-400 text-xs">Журнал тижня</span>
        <span className="text-zinc-600 text-xs"> · {weekLabel(week)}</span>
      </div>
      {!events.length ? (
        <div className="px-5 py-5 text-zinc-600 text-xs">
          На цьому тижні поки нічого не відбувалось.
        </div>
      ) : (
      <div className="divide-y divide-zinc-800/60">
      {events.map(e => (
        <div key={e.id} className="px-5 py-2.5">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-zinc-200 text-xs">{actorName(e.actor)}</span>
            <span className="text-zinc-500 text-xs">{EVENT_LABELS[e.type] ?? e.type}</span>
            <span className="text-zinc-600 text-xs ml-auto">{timeAgo(e.created_at)}</span>
          </div>
          {e.type === 'edited' && e.details && (
            <div className="mt-1 space-y-0.5">
              {!!e.details.added?.length && (
                <div className="text-emerald-400/80 text-[11px]">
                  + {e.details.added.map(describe).join(', ')}
                </div>
              )}
              {!!e.details.removed?.length && (
                <div className="text-red-400/80 text-[11px]">
                  − {e.details.removed.map(describe).join(', ')}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
      </div>
      )}
    </div>
  )
}

function SwapList({ swaps, operators, meId, manages, onChanged }: {
  swaps: Swap[]; operators: Operator[]; meId: string; manages: boolean; onChanged: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const byId = new Map(operators.map(o => [o.id, o]))

  async function decide(id: string, decision: 'approve' | 'decline') {
    setBusy(id)
    try {
      await fetch('/api/schedule/swap', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, decision }),
      })
      onChanged()
    } finally {
      setBusy(null)
    }
  }

  const LABEL: Record<string, string> = {
    pending: 'Очікує', approved: 'Підтверджено', declined: 'Відхилено', canceled: 'Скасовано',
  }
  const TONE: Record<string, string> = {
    pending: 'text-amber-300', approved: 'text-emerald-400',
    declined: 'text-red-400', canceled: 'text-zinc-500',
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-zinc-800">
        <h2 className="text-white font-semibold text-sm">Заміни</h2>
        <p className="text-zinc-500 text-xs mt-0.5">
          День переходить лише після згоди другого оператора і керівника
        </p>
      </div>
      <div className="divide-y divide-zinc-800/60">
        {swaps.map(s => {
          const canPeer = s.status === 'pending' && s.to_operator === meId && !s.peer_ok_at
          const canManager = s.status === 'pending' && manages && !s.manager_ok_at
          return (
            <div key={s.id} className="px-5 py-3 flex items-center gap-3 flex-wrap">
              <span className="text-zinc-300 text-xs whitespace-nowrap">{dayLabel(s.work_date)}</span>
              <span className="text-zinc-400 text-xs">
                {nameOf(byId.get(s.from_operator))} → {nameOf(byId.get(s.to_operator))}
              </span>
              {s.reason && <span className="text-zinc-600 text-xs truncate">· {s.reason}</span>}
              <span className={`text-xs ml-auto ${TONE[s.status]}`}>{LABEL[s.status]}</span>
              {s.status === 'pending' && (
                <span className="text-zinc-600 text-xs">
                  {s.peer_ok_at ? '✓ оператор' : '· оператор'}{' '}
                  {s.manager_ok_at ? '✓ керівник' : '· керівник'}
                </span>
              )}
              {(canPeer || canManager) && (
                <span className="flex items-center gap-1.5">
                  <button onClick={() => decide(s.id, 'approve')} disabled={busy === s.id}
                    className="px-2.5 py-1 rounded-lg text-xs bg-emerald-800/70 hover:bg-emerald-700 text-white transition-colors disabled:opacity-40">
                    Підтвердити
                  </button>
                  <button onClick={() => decide(s.id, 'decline')} disabled={busy === s.id}
                    className="px-2.5 py-1 rounded-lg text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors disabled:opacity-40">
                    Відхилити
                  </button>
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SwapDialog({ days, myDays, operators, initialDate, onClose, onDone }: {
  days: string[]; myDays: string[]; operators: Operator[]
  initialDate: string; onClose: () => void; onDone: () => void
}) {
  const [date, setDate] = useState(myDays.includes(initialDate) ? initialDate : (myDays[0] ?? days[0]))
  const [to, setTo] = useState(operators[0]?.id ?? '')
  const [reason, setReason] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  async function send() {
    setSending(true)
    setError('')
    try {
      const res = await fetch('/api/schedule/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ work_date: date, to_operator: to, reason }),
      })
      const d = await res.json()
      if (d.error) { setError(d.error); return }
      onDone()
    } catch {
      setError('Помилка мережі')
    } finally {
      setSending(false)
    }
  }

  const field = 'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-red-500'

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-md my-16" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
          <span className="text-white font-semibold">Запит на заміну</span>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-xl leading-none">×</button>
        </div>
        <div className="p-5 space-y-4">
          {myDays.length === 0 ? (
            <p className="text-zinc-400 text-sm">У вас немає зміни на цьому тижні, тож передавати нічого.</p>
          ) : (
            <>
              <div>
                <label className="block text-zinc-400 text-xs mb-1.5">Який день передаєте</label>
                <select value={date} onChange={e => setDate(e.target.value)} className={field}>
                  {myDays.map(d => (
                    <option key={d} value={d}>{WEEKDAYS[days.indexOf(d)]}, {dayLabel(d)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-zinc-400 text-xs mb-1.5">Кому</label>
                <select value={to} onChange={e => setTo(e.target.value)} className={field}>
                  {operators.map(o => <option key={o.id} value={o.id}>{nameOf(o)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-zinc-400 text-xs mb-1.5">
                  Причина <span className="text-zinc-600">— необовʼязково</span>
                </label>
                <input value={reason} onChange={e => setReason(e.target.value)} className={field}
                  placeholder="напр. сімейні обставини" />
              </div>
              {error && <p className="text-red-400 text-xs">{error}</p>}
              <button onClick={send} disabled={sending || !to}
                className="w-full px-4 py-2.5 rounded-lg text-sm bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-medium transition-colors">
                {sending ? 'Надсилання...' : 'Надіслати запит'}
              </button>
              <p className="text-zinc-600 text-xs">
                Запит піде другому оператору і керівнику. День перейде, коли обидва погодяться.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

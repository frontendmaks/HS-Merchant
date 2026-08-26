'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  STATUS_LABELS, WEEKDAYS, addDays, canApprove, dayLabel, isOverdue, isPastWeek,
  kyivToday, nextWeekStart, thisWeekStart, weekDates, weekLabel,
  type ScheduleStatus,
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

/** One colour per operator, so a glance at a column says who is on. */
const TONES = [
  { chip: 'bg-sky-500/80',     cell: 'bg-sky-500/25 hover:bg-sky-500/40',       ring: 'ring-sky-400/60' },
  { chip: 'bg-amber-400/90',   cell: 'bg-amber-400/25 hover:bg-amber-400/40',   ring: 'ring-amber-300/60' },
  { chip: 'bg-emerald-500/80', cell: 'bg-emerald-500/25 hover:bg-emerald-500/40', ring: 'ring-emerald-400/60' },
  { chip: 'bg-violet-500/80',  cell: 'bg-violet-500/25 hover:bg-violet-500/40', ring: 'ring-violet-400/60' },
  { chip: 'bg-rose-500/80',    cell: 'bg-rose-500/25 hover:bg-rose-500/40',     ring: 'ring-rose-400/60' },
  { chip: 'bg-teal-500/80',    cell: 'bg-teal-500/25 hover:bg-teal-500/40',     ring: 'ring-teal-400/60' },
]

const nameOf = (o: Operator | undefined) =>
  o ? (o.full_name || o.email) : '—'

const STATUS_TONE: Record<ScheduleStatus, string> = {
  draft: 'bg-zinc-800 text-zinc-400',
  submitted: 'bg-amber-950/60 text-amber-300',
  approved: 'bg-emerald-950/60 text-emerald-400',
}

export default function ScheduleClient({ week, role, meId, knownWeeks }: {
  week: string
  role: string
  meId: string
  knownWeeks: { week_start: string; status: string }[]
}) {
  const router = useRouter()
  const [schedule, setSchedule] = useState<Schedule | null>(null)
  const [operators, setOperators] = useState<Operator[]>([])
  const [swaps, setSwaps] = useState<Swap[]>([])
  const [marks, setMarks] = useState<Set<string>>(new Set())   // `${operatorId}|${date}`
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [swapFor, setSwapFor] = useState<{ date: string } | null>(null)

  const days = useMemo(() => weekDates(week), [week])
  const today = kyivToday()
  const manages = canApprove(role)
  const isOperator = role === 'operator'
  const past = isPastWeek(week)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/schedule?week=${week}`)
      const d = await res.json()
      if (d.error) { setError(d.error); return }
      setSchedule(d.schedule)
      setOperators(d.operators)
      setSwaps(d.swaps)
      setMarks(new Set((d.shifts as Shift[]).map(s => `${s.operator_id}|${s.work_date}`)))
      setDirty(false)
    } catch {
      setError('Не вдалося завантажити графік')
    } finally {
      setLoading(false)
    }
  }, [week])

  useEffect(() => { void load() }, [load])

  const toneOf = (index: number) => TONES[index % TONES.length]
  const key = (op: string, date: string) => `${op}|${date}`

  // Approved weeks change through a swap, not by clicking — that is the whole
  // point of the approval. Management can still reopen the week.
  const editable = !past && (schedule?.status !== 'approved' || manages)

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

  async function save() {
    setSaving(true)
    setError('')
    try {
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
      if (d.error) { setError(d.error); return }
      setDirty(false)
    } finally {
      setSaving(false)
    }
  }

  async function act(action: 'submit' | 'approve' | 'reopen') {
    setSaving(true)
    setError('')
    try {
      if (dirty) await save()
      const res = await fetch('/api/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week, action }),
      })
      const d = await res.json()
      if (d.error) { setError(d.error); return }
      await load()
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  const go = (w: string) => router.push(`/operators/schedule?week=${w}`)

  const pending = swaps.filter(s => s.status === 'pending')
  const nextMissing = knownWeeks.every(w => w.week_start !== nextWeekStart() || w.status === 'draft')

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">Графік роботи</h1>
          <p className="text-zinc-400 text-sm mt-0.5">
            {weekLabel(week)}
            {schedule && (
              <span className={`ml-2 text-xs px-2 py-0.5 rounded ${STATUS_TONE[schedule.status]}`}>
                {STATUS_LABELS[schedule.status]}
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => go(addDays(week, -7))}
            className="px-2.5 py-1.5 rounded-lg text-xs bg-zinc-800 text-zinc-400 hover:text-white transition-colors">
            ‹ Попередній
          </button>
          <button onClick={() => go(thisWeekStart())}
            className="px-2.5 py-1.5 rounded-lg text-xs bg-zinc-800 text-zinc-400 hover:text-white transition-colors">
            Поточний
          </button>
          <button onClick={() => go(nextWeekStart())}
            className="px-2.5 py-1.5 rounded-lg text-xs bg-zinc-800 text-zinc-400 hover:text-white transition-colors">
            Наступний
          </button>
          <button onClick={() => go(addDays(week, 7))}
            className="px-2.5 py-1.5 rounded-lg text-xs bg-zinc-800 text-zinc-400 hover:text-white transition-colors">
            Далі ›
          </button>
        </div>
      </div>

      {/* The Friday deadline, said plainly rather than left to be remembered */}
      {isOverdue() && nextMissing && week !== nextWeekStart() && (
        <div className="bg-amber-950/40 border border-amber-900/60 rounded-xl px-4 py-3">
          <div className="text-amber-300 text-sm">
            Графік на наступний тиждень ще не подано
          </div>
          <button onClick={() => go(nextWeekStart())}
            className="text-amber-400 hover:text-amber-300 text-xs mt-1 underline underline-offset-2">
            Скласти на {weekLabel(nextWeekStart())}
          </button>
        </div>
      )}

      {error && (
        <div className="bg-red-950/40 border border-red-900/60 rounded-xl px-4 py-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* The grid */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        {loading ? (
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
                  const tone = toneOf(i)
                  const count = days.filter(d => marks.has(key(op.id, d))).length
                  return (
                    <tr key={op.id} className="group">
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
                              title={editable ? (on ? 'Прибрати зміну' : 'Поставити зміну') : 'Графік закрито для редагування'}
                              className={`w-full h-9 rounded-md transition-colors relative ${
                                on
                                  ? `${tone.cell} ${swapPending ? `ring-2 ${tone.ring}` : ''}`
                                  : editable
                                    ? 'bg-zinc-800/40 hover:bg-zinc-800'
                                    : 'bg-zinc-800/20'
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

                {/* Days nobody covers are the thing a manager actually looks for */}
                <tr>
                  <td className="sticky left-0 z-10 bg-zinc-900 px-4 py-2">
                    <span className="text-zinc-500 text-xs">На зміні</span>
                  </td>
                  {days.map(d => {
                    const n = operators.filter(o => marks.has(key(o.id, d))).length
                    return (
                      <td key={d} className={`px-2 py-2 text-center ${d === today ? 'bg-zinc-800/30' : ''}`}>
                        <span className={`text-xs ${
                          n === 0 ? 'text-red-400 font-medium' : 'text-zinc-400'
                        }`}>
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

        {/* Actions */}
        {!loading && operators.length > 0 && (
          <div className="px-4 py-3 border-t border-zinc-800 flex items-center gap-3 flex-wrap">
            {editable && (
              <button
                onClick={save}
                disabled={saving || !dirty}
                className="px-3.5 py-1.5 rounded-lg text-xs bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-200 transition-colors"
              >
                {saving ? 'Збереження...' : dirty ? 'Зберегти' : 'Збережено'}
              </button>
            )}

            {editable && schedule?.status !== 'submitted' && (
              <button
                onClick={() => act('submit')}
                disabled={saving}
                className="px-3.5 py-1.5 rounded-lg text-xs bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white font-medium transition-colors"
              >
                Надіслати на підтвердження
              </button>
            )}

            {manages && schedule?.status === 'submitted' && (
              <button
                onClick={() => act('approve')}
                disabled={saving}
                className="px-3.5 py-1.5 rounded-lg text-xs bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white font-medium transition-colors"
              >
                Затвердити
              </button>
            )}

            {manages && schedule?.status === 'approved' && !past && (
              <button
                onClick={() => act('reopen')}
                disabled={saving}
                className="px-3.5 py-1.5 rounded-lg text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
              >
                Відкрити для змін
              </button>
            )}

            {isOperator && !past && (
              <button
                onClick={() => setSwapFor({ date: days.find(d => marks.has(key(meId, d))) ?? days[0] })}
                className="px-3.5 py-1.5 rounded-lg text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors ml-auto"
              >
                Попросити заміну
              </button>
            )}

            <span className="text-zinc-600 text-xs">
              {schedule?.approved_at
                ? `Затверджено ${timeAgo(schedule.approved_at)}`
                : schedule?.submitted_at
                  ? `Подано ${timeAgo(schedule.submitted_at)}`
                  : past ? 'Архів' : 'Дедлайн — пʼятниця до 16:00'}
            </span>
          </div>
        )}
      </div>

      {swaps.length > 0 && (
        <SwapList
          swaps={swaps}
          operators={operators}
          meId={meId}
          manages={manages}
          onChanged={() => { void load(); router.refresh() }}
        />
      )}

      {swapFor && (
        <SwapDialog
          days={days}
          myDays={days.filter(d => marks.has(key(meId, d)))}
          operators={operators.filter(o => o.id !== meId)}
          initialDate={swapFor.date}
          onClose={() => setSwapFor(null)}
          onDone={() => { setSwapFor(null); void load(); router.refresh() }}
        />
      )}
    </div>
  )
}

function SwapList({ swaps, operators, meId, manages, onChanged }: {
  swaps: Swap[]
  operators: Operator[]
  meId: string
  manages: boolean
  onChanged: () => void
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
          // Either half may still be outstanding, and saying which is the useful part
          const canPeer = s.status === 'pending' && s.to_operator === meId && !s.peer_ok_at
          const canManager = s.status === 'pending' && manages && !s.manager_ok_at
          return (
            <div key={s.id} className="px-5 py-3 flex items-center gap-3 flex-wrap">
              <span className="text-zinc-300 text-xs whitespace-nowrap">
                {dayLabel(s.work_date)}
              </span>
              <span className="text-zinc-400 text-xs">
                {nameOf(byId.get(s.from_operator))} → {nameOf(byId.get(s.to_operator))}
              </span>
              {s.reason && <span className="text-zinc-600 text-xs truncate">· {s.reason}</span>}

              <span className={`text-xs ml-auto ${TONE[s.status]}`}>{LABEL[s.status]}</span>

              {s.status === 'pending' && (
                <span className="text-zinc-600 text-xs">
                  {s.peer_ok_at ? '✓ оператор' : '· оператор'}
                  {' '}
                  {s.manager_ok_at ? '✓ керівник' : '· керівник'}
                </span>
              )}

              {(canPeer || canManager) && (
                <span className="flex items-center gap-1.5">
                  <button
                    onClick={() => decide(s.id, 'approve')}
                    disabled={busy === s.id}
                    className="px-2.5 py-1 rounded-lg text-xs bg-emerald-800/70 hover:bg-emerald-700 text-white transition-colors disabled:opacity-40"
                  >
                    Підтвердити
                  </button>
                  <button
                    onClick={() => decide(s.id, 'decline')}
                    disabled={busy === s.id}
                    className="px-2.5 py-1 rounded-lg text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors disabled:opacity-40"
                  >
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
  days: string[]
  myDays: string[]
  operators: Operator[]
  initialDate: string
  onClose: () => void
  onDone: () => void
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
            <p className="text-zinc-400 text-sm">
              У вас немає зміни на цьому тижні, тож передавати нічого.
            </p>
          ) : (
            <>
              <div>
                <label className="block text-zinc-400 text-xs mb-1.5">Який день передаєте</label>
                <select value={date} onChange={e => setDate(e.target.value)} className={field}>
                  {myDays.map(d => (
                    <option key={d} value={d}>
                      {WEEKDAYS[days.indexOf(d)]}, {dayLabel(d)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-zinc-400 text-xs mb-1.5">Кому</label>
                <select value={to} onChange={e => setTo(e.target.value)} className={field}>
                  {operators.map(o => (
                    <option key={o.id} value={o.id}>{nameOf(o)}</option>
                  ))}
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

              <button
                onClick={send}
                disabled={sending || !to}
                className="w-full px-4 py-2.5 rounded-lg text-sm bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-medium transition-colors"
              >
                {sending ? 'Надсилання...' : 'Надіслати запит'}
              </button>

              <p className="text-zinc-600 text-xs">
                Запит піде другому оператору і керівнику. День перейде, коли обидва
                погодяться.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

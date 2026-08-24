'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  REQUEST_CATEGORIES, STATUS_META, PRIORITY_META, STATUS_KEYS, PRIORITY_KEYS,
  categoryByKey, categoryLabel, sortForInbox, deadlineState, DEADLINE_TONE,
  type RequestStatus, type RequestPriority,
} from '@/lib/requests'
import { ROLE_LABELS } from '@/lib/roles'

interface Person { id: string; full_name: string | null; email: string; role: string }
interface Note {
  id: string
  body: string
  created_at: string
  author_id: string
  author: { full_name: string | null; email: string } | null
}
export interface WorkRequest {
  id: string
  category: string
  subject: string
  description: string | null
  status: RequestStatus
  priority: RequestPriority
  deadline: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
  created_by: string
  assigned_to: string
  author: Person | null
  assignee: Person | null
  notes: Note[] | null
}

const name = (p: { full_name: string | null; email: string } | null | undefined) =>
  p?.full_name?.trim() || p?.email || '—'

const initials = (p: { full_name: string | null; email: string } | null | undefined) =>
  (name(p) || '?').slice(0, 1).toUpperCase()

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

function Badge({ text, cls }: { text: string; cls: string }) {
  return <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{text}</span>
}

/** Date field that opens the picker from anywhere in the input, not just the icon.
 *  showPicker() throws when it isn't tied to a user gesture, so it stays guarded. */
function DateInput({ value, onChange, disabled, className }: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  className: string
}) {
  const openPicker = (el: HTMLInputElement) => {
    try { el.showPicker?.() } catch { /* not a user gesture — the icon still works */ }
  }
  return (
    <input
      type="date"
      value={value}
      disabled={disabled}
      onChange={e => onChange(e.target.value)}
      onClick={e => openPicker(e.currentTarget)}
      onFocus={e => openPicker(e.currentTarget)}
      className={`${className} cursor-pointer`}
    />
  )
}

export default function RequestsClient({ initialRequests, people, me, isAdmin }: {
  initialRequests: WorkRequest[]
  people: Person[]
  me: Person
  isAdmin: boolean
}) {
  const router = useRouter()
  const [requests, setRequests] = useState<WorkRequest[]>(initialRequests)
  const [openId, setOpenId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // History filters
  const [scope, setScope] = useState<'all' | 'mine' | 'assigned'>('all')
  const [statusFilter, setStatusFilter] = useState<string>('open')
  const [search, setSearch] = useState('')

  async function refresh() {
    const res = await fetch('/api/requests')
    if (res.ok) {
      const data = await res.json() as { requests: WorkRequest[] }
      setRequests(data.requests)
    }
    router.refresh()
  }

  const inbox = useMemo(
    () => sortForInbox(requests.filter(r => r.assigned_to === me.id && r.status !== 'done' && r.status !== 'canceled')),
    [requests, me.id]
  )

  const history = useMemo(() => {
    let rows = requests
    if (scope === 'mine') rows = rows.filter(r => r.created_by === me.id)
    if (scope === 'assigned') rows = rows.filter(r => r.assigned_to === me.id)
    if (statusFilter === 'open') rows = rows.filter(r => r.status !== 'done' && r.status !== 'canceled')
    else if (statusFilter !== 'all') rows = rows.filter(r => r.status === statusFilter)
    const q = search.trim().toLowerCase()
    if (q) {
      rows = rows.filter(r =>
        r.subject.toLowerCase().includes(q) ||
        (r.description ?? '').toLowerCase().includes(q) ||
        name(r.author).toLowerCase().includes(q) ||
        name(r.assignee).toLowerCase().includes(q)
      )
    }
    return sortForInbox(rows)
  }, [requests, scope, statusFilter, search, me.id])

  const open = requests.find(r => r.id === openId) ?? null

  async function patch(id: string, payload: Record<string, unknown>) {
    setBusy(true)
    try {
      const res = await fetch('/api/requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...payload }),
      })
      if (res.ok) await refresh()
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    if (!confirm('Видалити цей запит?')) return
    setBusy(true)
    try {
      const res = await fetch('/api/requests', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (res.ok) { setOpenId(null); await refresh() }
    } finally {
      setBusy(false)
    }
  }

  const openCount = requests.filter(r => r.status !== 'done' && r.status !== 'canceled').length
  const overdue = inbox.filter(r => deadlineState(r.deadline, r.status).tone === 'overdue').length

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Запити</h1>
          <p className="text-zinc-400 text-sm mt-0.5">
            {isAdmin ? 'Усі запити команди' : 'Ваші запити та завдання'}
            {' · '}<span className="text-zinc-300">{openCount}</span> активних
            {overdue > 0 && <> · <span className="text-red-400">{overdue} протерміновано</span></>}
          </p>
        </div>
      </div>

      {/* Top: my inbox | new request */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
        <Inbox
          rows={inbox}
          onOpen={setOpenId}
          onStatus={(id, status) => patch(id, { status })}
          busy={busy}
        />
        <CreateForm people={people} me={me} onCreated={refresh} />
      </div>

      {/* Bottom: full history */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-zinc-800">
          <h2 className="text-white font-semibold text-sm">Історія запитів</h2>
          <span className="text-zinc-600 text-xs">{history.length}</span>

          <div className="flex-1" />

          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Пошук..."
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-white text-xs placeholder-zinc-600 focus:outline-none focus:border-red-500 w-48"
          />

          <div className="flex gap-1">
            {([
              ['all', isAdmin ? 'Усі' : 'Всі мої'],
              ['assigned', 'Мені'],
              ['mine', 'Від мене'],
            ] as const).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setScope(k)}
                className={`px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                  scope === k ? 'bg-red-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none focus:border-red-500"
          >
            <option value="open">Активні</option>
            <option value="all">Усі статуси</option>
            {STATUS_KEYS.map(s => (
              <option key={s} value={s}>{STATUS_META[s].label}</option>
            ))}
          </select>
        </div>

        {history.length === 0 ? (
          <div className="px-4 py-10 text-center text-zinc-600 text-sm">Запитів не знайдено</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500 text-xs">
                <th className="text-left px-4 py-2.5">Запит</th>
                <th className="text-left px-4 py-2.5 whitespace-nowrap">Категорія</th>
                <th className="text-left px-4 py-2.5 whitespace-nowrap">Від кого</th>
                <th className="text-left px-4 py-2.5 whitespace-nowrap">Кому</th>
                <th className="text-left px-4 py-2.5 whitespace-nowrap">Пріоритет</th>
                <th className="text-left px-4 py-2.5 whitespace-nowrap">Дедлайн</th>
                <th className="text-left px-4 py-2.5 whitespace-nowrap">Статус</th>
                <th className="text-left px-4 py-2.5 whitespace-nowrap">Створено</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {history.map(r => {
                const dl = deadlineState(r.deadline, r.status)
                const noteCount = r.notes?.length ?? 0
                return (
                  <tr
                    key={r.id}
                    onClick={() => setOpenId(r.id)}
                    className="hover:bg-zinc-800/30 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-2.5 text-white text-xs max-w-[320px]">
                      <div className="truncate">{r.subject}</div>
                      {noteCount > 0 && (
                        <div className="text-zinc-600 text-xs mt-0.5">{noteCount} нотаток</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-zinc-400 text-xs whitespace-nowrap">
                      {categoryByKey(r.category)?.icon} {categoryLabel(r.category)}
                    </td>
                    <td className="px-4 py-2.5 text-zinc-400 text-xs whitespace-nowrap">{name(r.author)}</td>
                    <td className="px-4 py-2.5 text-zinc-300 text-xs whitespace-nowrap">{name(r.assignee)}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <Badge text={PRIORITY_META[r.priority].label} cls={PRIORITY_META[r.priority].badge} />
                    </td>
                    <td className={`px-4 py-2.5 text-xs whitespace-nowrap ${DEADLINE_TONE[dl.tone]}`}>
                      {dl.label}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <Badge text={STATUS_META[r.status].label} cls={STATUS_META[r.status].badge} />
                    </td>
                    <td className="px-4 py-2.5 text-zinc-600 text-xs whitespace-nowrap">
                      {fmtDateTime(r.created_at)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {open && (
        <DetailModal
          request={open}
          me={me}
          isAdmin={isAdmin}
          busy={busy}
          onClose={() => setOpenId(null)}
          onPatch={patch}
          onDelete={remove}
          onNoteAdded={refresh}
        />
      )}
    </div>
  )
}

// --- My inbox -------------------------------------------------------------

function Inbox({ rows, onOpen, onStatus, busy }: {
  rows: WorkRequest[]
  onOpen: (id: string) => void
  onStatus: (id: string, status: RequestStatus) => void
  busy: boolean
}) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2">
        <h2 className="text-white font-semibold text-sm">Мені треба зробити</h2>
        <span className="text-zinc-600 text-xs">{rows.length}</span>
      </div>

      {rows.length === 0 ? (
        <div className="px-4 py-10 text-center text-zinc-600 text-sm">
          Активних запитів немає
        </div>
      ) : (
        <div className="divide-y divide-zinc-800/60 max-h-[560px] overflow-y-auto">
          {rows.map(r => {
            const dl = deadlineState(r.deadline, r.status)
            return (
              <div
                key={r.id}
                onClick={() => onOpen(r.id)}
                className="px-4 py-3 hover:bg-zinc-800/30 transition-colors cursor-pointer"
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge text={PRIORITY_META[r.priority].label} cls={PRIORITY_META[r.priority].badge} />
                      <Badge text={STATUS_META[r.status].label} cls={STATUS_META[r.status].badge} />
                      <span className="text-zinc-600 text-xs">
                        {categoryByKey(r.category)?.icon} {categoryLabel(r.category)}
                      </span>
                    </div>
                    <div className="text-white text-sm mt-1.5">{r.subject}</div>
                    {r.description && (
                      <div className="text-zinc-500 text-xs mt-0.5 line-clamp-2">{r.description}</div>
                    )}
                    <div className="flex items-center gap-3 mt-1.5">
                      <span className={`text-xs ${DEADLINE_TONE[dl.tone]}`}>◷ {dl.label}</span>
                      <span className="text-zinc-600 text-xs">від {name(r.author)}</span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
                    {r.status === 'new' && (
                      <button
                        disabled={busy}
                        onClick={() => onStatus(r.id, 'in_progress')}
                        className="px-2.5 py-1 rounded-lg text-xs bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                      >
                        В роботу
                      </button>
                    )}
                    <button
                      disabled={busy}
                      onClick={() => onStatus(r.id, 'done')}
                      className="px-2.5 py-1 rounded-lg text-xs bg-emerald-900/60 text-emerald-300 hover:bg-emerald-800/60 disabled:opacity-50 transition-colors whitespace-nowrap"
                    >
                      Виконано
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// --- Create form ----------------------------------------------------------

function CreateForm({ people, me, onCreated }: {
  people: Person[]
  me: Person
  onCreated: () => Promise<void>
}) {
  const [categoryKey, setCategoryKey] = useState(REQUEST_CATEGORIES[0].key)
  const [subject, setSubject] = useState(REQUEST_CATEGORIES[0].subjects[0])
  const [customSubject, setCustomSubject] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [priority, setPriority] = useState<RequestPriority>('normal')
  const [deadline, setDeadline] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')

  const category = categoryByKey(categoryKey)!
  const isCustom = subject === '__custom__'

  function pickCategory(key: string) {
    setCategoryKey(key)
    setSubject(categoryByKey(key)!.subjects[0])
    setCustomSubject('')
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setOk('')

    const finalSubject = isCustom ? customSubject.trim() : subject
    if (!assignedTo) return setError('Оберіть виконавця')
    if (!finalSubject) return setError('Вкажіть суть запиту')

    setSaving(true)
    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assigned_to: assignedTo,
          category: categoryKey,
          subject: finalSubject,
          description,
          priority,
          deadline: deadline || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Помилка')

      setOk('Запит створено та надіслано')
      setDescription(''); setDeadline(''); setCustomSubject(''); setPriority('normal')
      await onCreated()
      setTimeout(() => setOk(''), 4000)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const field = 'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-red-500'
  const label = 'block text-zinc-400 text-xs mb-1.5'

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800">
        <h2 className="text-white font-semibold text-sm">Створити запит</h2>
      </div>

      <form onSubmit={submit} className="p-4 space-y-4">
        {/* Category tiles — faster than a dropdown and shows what exists */}
        <div>
          <label className={label}>Категорія *</label>
          <div className="flex flex-wrap gap-1.5">
            {REQUEST_CATEGORIES.map(c => (
              <button
                key={c.key}
                type="button"
                onClick={() => pickCategory(c.key)}
                className={`px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                  categoryKey === c.key
                    ? 'bg-red-600 text-white'
                    : 'bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700'
                }`}
              >
                {c.icon} {c.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className={label}>Запит *</label>
          <select value={subject} onChange={e => setSubject(e.target.value)} className={field}>
            {category.subjects.map(s => <option key={s} value={s}>{s}</option>)}
            <option value="__custom__">Інше (вписати вручну)…</option>
          </select>
          {isCustom && (
            <input
              value={customSubject}
              onChange={e => setCustomSubject(e.target.value)}
              placeholder="Коротко сформулюйте запит"
              className={`${field} mt-2`}
            />
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Кому *</label>
            <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)} className={field}>
              <option value="">Оберіть виконавця</option>
              {people.map(p => (
                <option key={p.id} value={p.id}>
                  {name(p)}{p.id === me.id ? ' (я)' : ''} — {ROLE_LABELS[p.role] ?? p.role}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Пріоритет</label>
            <select
              value={priority}
              onChange={e => setPriority(e.target.value as RequestPriority)}
              className={field}
            >
              {PRIORITY_KEYS.map(p => (
                <option key={p} value={p}>{PRIORITY_META[p].label}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className={label}>Дедлайн</label>
          <DateInput value={deadline} onChange={setDeadline} className={field} />
        </div>

        <div>
          <label className={label}>Опис</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={4}
            placeholder="Деталі: який товар, де саме проблема, скільки замовити…"
            className={`${field} resize-none`}
          />
        </div>

        {error && <div className="text-red-400 text-sm">{error}</div>}
        {ok && (
          <div className="bg-emerald-950/50 border border-emerald-800 rounded-lg px-3 py-2 text-emerald-400 text-sm">
            ✓ {ok}
          </div>
        )}

        <button
          type="submit"
          disabled={saving}
          className="w-full px-4 py-2.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {saving ? 'Надсилання...' : 'Надіслати запит'}
        </button>
      </form>
    </div>
  )
}

// --- Detail modal ---------------------------------------------------------

function DetailModal({ request: r, me, isAdmin, busy, onClose, onPatch, onDelete, onNoteAdded }: {
  request: WorkRequest
  me: Person
  isAdmin: boolean
  busy: boolean
  onClose: () => void
  onPatch: (id: string, payload: Record<string, unknown>) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onNoteAdded: () => Promise<void>
}) {
  const [note, setNote] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [noteError, setNoteError] = useState('')

  const involved = r.created_by === me.id || r.assigned_to === me.id
  const canEdit = involved || isAdmin
  const canDelete = r.created_by === me.id
  const dl = deadlineState(r.deadline, r.status)
  const notes = [...(r.notes ?? [])].sort((a, b) => a.created_at < b.created_at ? -1 : 1)

  async function addNote(e: React.FormEvent) {
    e.preventDefault()
    if (!note.trim()) return
    setNoteError('')
    setSavingNote(true)
    try {
      const res = await fetch('/api/requests/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: r.id, body: note }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Помилка')
      setNote('')
      await onNoteAdded()
    } catch (e) {
      setNoteError(e instanceof Error ? e.message : String(e))
    } finally {
      setSavingNote(false)
    }
  }

  const control = 'bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-white text-xs focus:outline-none focus:border-red-500 disabled:opacity-50'

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-2xl my-8"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-zinc-800 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <Badge text={STATUS_META[r.status].label} cls={STATUS_META[r.status].badge} />
              <Badge text={PRIORITY_META[r.priority].label} cls={PRIORITY_META[r.priority].badge} />
              <span className="text-zinc-500 text-xs">
                {categoryByKey(r.category)?.icon} {categoryLabel(r.category)}
              </span>
            </div>
            <h3 className="text-white font-semibold">{r.subject}</h3>
            <div className="text-zinc-500 text-xs mt-1">
              {name(r.author)} → {name(r.assignee)} · створено {fmtDateTime(r.created_at)}
            </div>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-xl leading-none px-1">×</button>
        </div>

        <div className="p-5 space-y-5">
          {r.description && (
            <div>
              <div className="text-zinc-400 text-xs mb-1.5">Опис</div>
              <div className="text-zinc-200 text-sm whitespace-pre-wrap bg-zinc-800/40 rounded-lg px-3 py-2.5">
                {r.description}
              </div>
            </div>
          )}

          {/* Controls */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="text-zinc-400 text-xs mb-1.5">Статус</div>
              <select
                value={r.status}
                disabled={!canEdit || busy}
                onChange={e => onPatch(r.id, { status: e.target.value })}
                className={`${control} w-full`}
              >
                {STATUS_KEYS.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
              </select>
            </div>
            <div>
              <div className="text-zinc-400 text-xs mb-1.5">Пріоритет</div>
              <select
                value={r.priority}
                disabled={!canEdit || busy}
                onChange={e => onPatch(r.id, { priority: e.target.value })}
                className={`${control} w-full`}
              >
                {PRIORITY_KEYS.map(p => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}
              </select>
            </div>
            <div>
              <div className="text-zinc-400 text-xs mb-1.5">Дедлайн</div>
              <DateInput
                value={r.deadline ?? ''}
                disabled={!canEdit || busy}
                onChange={v => onPatch(r.id, { deadline: v || null })}
                className={`${control} w-full`}
              />
            </div>
          </div>

          <div className={`text-xs ${DEADLINE_TONE[dl.tone]}`}>◷ {dl.label}</div>

          {/* Notes */}
          <div>
            <div className="text-zinc-400 text-xs mb-2">Нотатки {notes.length > 0 && `(${notes.length})`}</div>

            {notes.length > 0 && (
              <div className="space-y-2 mb-3 max-h-60 overflow-y-auto">
                {notes.map(n => (
                  <div key={n.id} className="flex gap-2.5">
                    <div className="w-6 h-6 rounded-full bg-zinc-700 flex items-center justify-center text-zinc-300 text-xs font-semibold shrink-0 mt-0.5">
                      {initials(n.author)}
                    </div>
                    <div className="min-w-0 flex-1 bg-zinc-800/40 rounded-lg px-3 py-2">
                      <div className="flex items-baseline gap-2">
                        <span className="text-zinc-300 text-xs font-medium">{name(n.author)}</span>
                        <span className="text-zinc-600 text-xs">{fmtDateTime(n.created_at)}</span>
                      </div>
                      <div className="text-zinc-200 text-sm mt-0.5 whitespace-pre-wrap">{n.body}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {canEdit && (
              <form onSubmit={addNote} className="flex gap-2">
                <input
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="Додати нотатку..."
                  className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-red-500"
                />
                <button
                  type="submit"
                  disabled={savingNote || !note.trim()}
                  className="px-3.5 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-200 text-sm rounded-lg transition-colors"
                >
                  {savingNote ? '...' : 'Додати'}
                </button>
              </form>
            )}
            {noteError && <div className="text-red-400 text-xs mt-1.5">{noteError}</div>}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-zinc-800 flex justify-between items-center">
          {canDelete ? (
            <button
              onClick={() => onDelete(r.id)}
              disabled={busy}
              className="text-xs text-red-500 hover:text-red-400 disabled:opacity-50 transition-colors"
            >
              Видалити запит
            </button>
          ) : <span />}
          <button
            onClick={onClose}
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded-lg transition-colors"
          >
            Закрити
          </button>
        </div>
      </div>
    </div>
  )
}

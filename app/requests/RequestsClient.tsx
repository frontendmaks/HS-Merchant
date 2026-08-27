'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  REQUEST_CATEGORIES, STATUS_META, PRIORITY_META, STATUS_KEYS, PRIORITY_KEYS,
  EVENT_META, eventValue, categoryByKey, categoryLabel, sortForInbox,
  deadlineState, DEADLINE_TONE, isClosed, statusOptionsFor,
  MIN_RESOLUTION_LENGTH, RESOLUTION_REQUIRED_STATUSES,
  type RequestStatus, type RequestPriority, type RequestEventType,
} from '@/lib/requests'
import { timeAgo } from '@/lib/format'

const POLL_MS = 15_000

interface Person { id: string; full_name: string | null; email: string; role: string }
interface Note {
  id: string
  body: string
  created_at: string
  author_id: string
  author: { full_name: string | null; email: string } | null
}
interface Event {
  id: string
  type: string
  old_value: string | null
  new_value: string | null
  created_at: string
  actor: { full_name: string | null; email: string } | null
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
  author: Person | null
  assignees: Person[]
  notes: Note[] | null
  events: Event[] | null
  /** What the assignee said they did, recorded when they handed it over */
  resolution: string | null
  resolution_url: string | null
  resolution_files: { path: string; name: string; size: number; type?: string }[] | null
  resolved_at: string | null
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

/** Small avatar + name, used wherever a person is shown. */
function PersonChip({ person, label }: { person: Person | null | undefined; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {label && <span className="text-zinc-600 text-xs">{label}</span>}
      <span className="w-4 h-4 rounded-full bg-zinc-700 text-zinc-300 text-[9px] font-semibold flex items-center justify-center shrink-0">
        {initials(person)}
      </span>
      <span className="text-zinc-300 text-xs">{name(person)}</span>
    </span>
  )
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

/** Collapsed like a select, but opens into a checkbox list — a request often
 *  goes to two operators at once. */
function PeoplePicker({ people, selected, onToggle, meId, disabled }: {
  people: Person[]
  selected: string[]
  onToggle: (id: string) => void
  meId: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const chosen = people.filter(p => selected.includes(p.id))
  const summary = chosen.length === 0
    ? 'Оберіть виконавців'
    : chosen.map(p => name(p)).join(', ')

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-left text-sm focus:outline-none focus:border-red-500 disabled:opacity-50"
      >
        <span className={`truncate ${chosen.length ? 'text-white' : 'text-zinc-600'}`}>
          {summary}
        </span>
        <span className="text-zinc-500 text-xs shrink-0">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full max-h-52 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-800 shadow-2xl divide-y divide-zinc-700/50">
          {people.map(p => (
            <label
              key={p.id}
              className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-zinc-700/40 transition-colors"
            >
              <input
                type="checkbox"
                checked={selected.includes(p.id)}
                onChange={() => onToggle(p.id)}
                className="w-4 h-4 accent-red-600"
              />
              <span className="w-5 h-5 rounded-full bg-zinc-700 text-zinc-300 text-[10px] font-semibold flex items-center justify-center shrink-0">
                {initials(p)}
              </span>
              <span className="text-white text-sm">
                {name(p)}{p.id === meId && <span className="text-zinc-500"> (я)</span>}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

export default function RequestsClient({ initialRequests, people, me, isAdmin }: {
  initialRequests: WorkRequest[]
  people: Person[]
  me: Person
  isAdmin: boolean
}) {
  const [requests, setRequests] = useState<WorkRequest[]>(initialRequests)
  const [openId, setOpenId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [scope, setScope] = useState<'all' | 'mine' | 'assigned'>('all')
  const [statusFilter, setStatusFilter] = useState<string>('open')
  const [search, setSearch] = useState('')

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/requests')
      if (!res.ok) return
      const data = await res.json() as { requests: WorkRequest[] }
      setRequests(data.requests)
    } catch { /* offline — the next tick retries */ }
  }, [])

  // Keep the board current without a manual reload
  useEffect(() => {
    const timer = setInterval(refresh, POLL_MS)
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => { clearInterval(timer); window.removeEventListener('focus', onFocus) }
  }, [refresh])

  const isMine = useCallback(
    (r: WorkRequest) => r.assignees.some(a => a.id === me.id), [me.id])

  // What I have to do — excludes work already sent for the author's sign-off
  const todo = useMemo(
    () => sortForInbox(requests.filter(
      r => isMine(r) && !isClosed(r.status) && r.status !== 'pending_review')),
    [requests, isMine]
  )

  // What is waiting on me to accept
  const toReview = useMemo(
    () => sortForInbox(requests.filter(
      r => r.created_by === me.id && r.status === 'pending_review')),
    [requests, me.id]
  )

  const history = useMemo(() => {
    let rows = requests
    if (scope === 'mine') rows = rows.filter(r => r.created_by === me.id)
    if (scope === 'assigned') rows = rows.filter(isMine)
    if (statusFilter === 'open') rows = rows.filter(r => !isClosed(r.status))
    else if (statusFilter !== 'all') rows = rows.filter(r => r.status === statusFilter)
    const q = search.trim().toLowerCase()
    if (q) {
      rows = rows.filter(r =>
        r.subject.toLowerCase().includes(q) ||
        (r.description ?? '').toLowerCase().includes(q) ||
        name(r.author).toLowerCase().includes(q) ||
        r.assignees.some(a => name(a).toLowerCase().includes(q))
      )
    }
    return sortForInbox(rows)
  }, [requests, scope, statusFilter, search, me.id, isMine])

  const open = requests.find(r => r.id === openId) ?? null

  const patch = useCallback(async (id: string, payload: Record<string, unknown>) => {
    setBusy(true)
    try {
      const res = await fetch('/api/requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...payload }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(data.error || 'Не вдалося зберегти зміну')
        throw new Error(data.error || 'Не вдалося зберегти зміну')
      }
      // Splice the one row the server sends back rather than refetching the
      // board — the poll and the focus handler still reconcile the rest.
      if (data.request) {
        setRequests(list => list.map(r => (r.id === id ? data.request : r)))
      } else {
        await refresh()
      }
    } finally {
      setBusy(false)
    }
  }, [refresh])

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

  const openCount = requests.filter(r => !isClosed(r.status)).length
  const overdue = todo.filter(r => deadlineState(r.deadline, r.status).tone === 'overdue').length

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white">Запити</h1>
        <p className="text-zinc-400 text-sm mt-0.5">
          {isAdmin ? 'Усі запити команди' : 'Ваші запити та завдання'}
          {' · '}<span className="text-zinc-300">{openCount}</span> активних
          {overdue > 0 && <> · <span className="text-red-400">{overdue} протерміновано</span></>}
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
        <div className="space-y-5">
          {toReview.length > 0 && (
            <ReviewList rows={toReview} onOpen={setOpenId} onPatch={patch} busy={busy} />
          )}
          <Inbox rows={todo} me={me} onOpen={setOpenId} onPatch={patch} busy={busy} />
        </div>
        <CreateForm people={people} me={me} onCreated={refresh} />
      </div>

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
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-500 text-xs">
                  <th className="text-left px-4 py-2.5">Запит</th>
                  <th className="text-left px-4 py-2.5 whitespace-nowrap">Категорія</th>
                  <th className="text-left px-4 py-2.5 whitespace-nowrap">Хто поставив</th>
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
                      <td className="px-4 py-2.5 whitespace-nowrap"><PersonChip person={r.author} /></td>
                      <td className="px-4 py-2.5 text-zinc-300 text-xs whitespace-nowrap">
                        {r.assignees.map(a => name(a)).join(', ') || '—'}
                      </td>
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
          </div>
        )}
      </div>

      {open && (
        <DetailModal
          request={open}
          me={me}
          people={people}
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

// --- Waiting for my sign-off ---------------------------------------------

function ReviewList({ rows, onOpen, onPatch, busy }: {
  rows: WorkRequest[]
  onOpen: (id: string) => void
  onPatch: (id: string, payload: Record<string, unknown>) => Promise<void>
  busy: boolean
}) {
  return (
    <div className="bg-zinc-900 border border-purple-900/60 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2">
        <h2 className="text-white font-semibold text-sm">Чекають вашого підтвердження</h2>
        <span className="text-purple-400 text-xs">{rows.length}</span>
      </div>
      <div className="divide-y divide-zinc-800/60">
        {rows.map(r => (
          <div key={r.id} className="px-4 py-3">
            <div
              onClick={() => onOpen(r.id)}
              className="cursor-pointer hover:opacity-80 transition-opacity"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <Badge text={STATUS_META[r.status].label} cls={STATUS_META[r.status].badge} />
                <span className="text-zinc-600 text-xs">
                  {categoryByKey(r.category)?.icon} {categoryLabel(r.category)}
                </span>
              </div>
              <div className="text-white text-sm mt-1.5">{r.subject}</div>
              <div className="text-zinc-500 text-xs mt-1">
                виконав: {r.assignees.map(a => name(a)).join(', ')}
              </div>
            </div>
            <div className="flex gap-2 mt-2.5">
              <button
                disabled={busy}
                onClick={() => onPatch(r.id, { status: 'done' })}
                className="px-3 py-1.5 rounded-lg text-xs bg-emerald-900/60 text-emerald-300 hover:bg-emerald-800/60 disabled:opacity-50 transition-colors"
              >
                ✓ Підтвердити виконання
              </button>
              <button
                disabled={busy}
                onClick={() => onPatch(r.id, { status: 'rework' })}
                className="px-3 py-1.5 rounded-lg text-xs bg-orange-950/60 text-orange-400 hover:bg-orange-900/60 disabled:opacity-50 transition-colors"
              >
                ↩ На доопрацювання
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// --- My inbox -------------------------------------------------------------

function Inbox({ rows, me, onOpen, onPatch, busy }: {
  rows: WorkRequest[]
  me: Person
  onOpen: (id: string) => void
  onPatch: (id: string, payload: Record<string, unknown>) => Promise<void>
  busy: boolean
}) {
  const [tab, setTab] = useState<'all' | 'in_progress'>('all')
  const [resolving, setResolving] = useState<{ request: WorkRequest; target: 'done' | 'pending_review' } | null>(null)
  const shown = tab === 'all' ? rows : rows.filter(r => r.status === 'in_progress')
  const inProgress = rows.filter(r => r.status === 'in_progress').length

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-3 flex-wrap">
        <h2 className="text-white font-semibold text-sm">Мені треба зробити</h2>
        <div className="inline-flex bg-zinc-800 rounded-lg p-0.5 ml-auto">
          {([['all', 'Всі', rows.length], ['in_progress', 'В роботі', inProgress]] as const).map(
            ([key, label, count]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                  tab === key ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'
                }`}
              >
                {label} <span className="text-zinc-500">{count}</span>
              </button>
            ),
          )}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="px-4 py-10 text-center text-zinc-600 text-sm">
          {tab === 'in_progress' ? 'Нічого не взято в роботу' : 'Активних запитів немає'}
        </div>
      ) : (
        <div className="divide-y divide-zinc-800/60 max-h-[560px] overflow-y-auto">
          {shown.map(r => {
            const dl = deadlineState(r.deadline, r.status)
            // Self-assigned work needs no sign-off from anyone else
            const selfAssigned = r.created_by === me.id
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

                    <div className="flex items-center gap-3 mt-2 flex-wrap">
                      <PersonChip person={r.author} label="Поставив:" />
                      <span className={`text-xs ${DEADLINE_TONE[dl.tone]}`}>◷ {dl.label}</span>
                    </div>
                    {r.assignees.length > 1 && (
                      <div className="text-zinc-600 text-xs mt-1">
                        Разом з вами: {r.assignees.filter(a => a.id !== me.id).map(a => name(a)).join(', ')}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
                    {r.status !== 'in_progress' && (
                      <button
                        disabled={busy}
                        onClick={() => onPatch(r.id, { status: 'in_progress' })}
                        className="px-2.5 py-1 rounded-lg text-xs bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                      >
                        В роботу
                      </button>
                    )}
                    <button
                      disabled={busy}
                      onClick={() => setResolving({ request: r, target: selfAssigned ? 'done' : 'pending_review' })}
                      className="px-2.5 py-1 rounded-lg text-xs bg-emerald-900/60 text-emerald-300 hover:bg-emerald-800/60 disabled:opacity-50 transition-colors whitespace-nowrap"
                      title={selfAssigned ? 'Закрити запит' : 'Надіслати на підтвердження автору'}
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

      {resolving && (
        <ResolutionDialog
          request={resolving.request}
          target={resolving.target}
          onClose={() => setResolving(null)}
          onDone={async payload => {
            await onPatch(resolving.request.id, payload)
            setResolving(null)
          }}
        />
      )}
    </div>
  )
}

interface ResolutionFile { path: string; name: string; size: number; type?: string }

/**
 * What was done, asked for at the moment the work is handed over.
 *
 * A note is required — "Виконано" with nothing behind it leaves the author to
 * go and ask. A link and screenshots are optional because much of this work is
 * a page to look at or a screen to see, and describing those in words is worse
 * than showing them.
 */
function ResolutionDialog({ request, target, onClose, onDone }: {
  request: WorkRequest
  target: 'done' | 'pending_review'
  onClose: () => void
  onDone: (payload: Record<string, unknown>) => Promise<void>
}) {
  const [text, setText] = useState(request.resolution ?? '')
  const [url, setUrl] = useState(request.resolution_url ?? '')
  const [files, setFiles] = useState<ResolutionFile[]>(request.resolution_files ?? [])
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const enough = text.trim().length >= MIN_RESOLUTION_LENGTH

  async function upload(list: FileList | null) {
    if (!list?.length) return
    setUploading(true)
    setError('')
    try {
      // In parallel: three screenshots should take as long as the slowest, not
      // the sum of all three
      const results = await Promise.all(Array.from(list).map(async file => {
        const fd = new FormData()
        fd.append('file', file)
        fd.append('request_id', request.id)
        const res = await fetch('/api/requests/files', { method: 'POST', body: fd })
        return res.json() as Promise<{ file?: ResolutionFile; error?: string }>
      }))
      const failed = results.find(r => r.error)
      if (failed?.error) setError(failed.error)
      const added = results.map(r => r.file).filter((f): f is ResolutionFile => !!f)
      if (added.length) setFiles(f => [...f, ...added])
    } finally {
      setUploading(false)
    }
  }

  async function submit() {
    if (!enough) return
    setSaving(true)
    setError('')
    try {
      await onDone({
        status: target,
        resolution: text.trim(),
        resolution_url: url.trim(),
        resolution_files: files,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалося зберегти')
    } finally {
      setSaving(false)
    }
  }

  const field = 'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-red-500'

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-start justify-center p-4 overflow-y-auto"
         onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-lg my-12"
           onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-zinc-800 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-white font-semibold">
              {target === 'done' ? 'Закрити запит' : 'Надіслати на підтвердження'}
            </div>
            <div className="text-zinc-500 text-xs mt-0.5 truncate">{request.subject}</div>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-zinc-400 text-xs mb-1.5">
              Що зроблено <span className="text-red-400">*</span>
            </label>
            <textarea
              autoFocus
              value={text}
              onChange={e => setText(e.target.value)}
              rows={4}
              placeholder="Напр. Оновив ціни на 12 позиціях у фіді MauDau, перевірив вивантаження"
              className={`${field} resize-y`}
            />
            <div className={`text-xs mt-1 ${enough ? 'text-zinc-600' : 'text-amber-500/80'}`}>
              {enough
                ? 'Це побачить той, хто поставив запит'
                : `Ще ${MIN_RESOLUTION_LENGTH - text.trim().length} символів`}
            </div>
          </div>

          <div>
            <label className="block text-zinc-400 text-xs mb-1.5">
              Посилання <span className="text-zinc-600">— необовʼязково</span>
            </label>
            <input value={url} onChange={e => setUrl(e.target.value)} className={field}
                   placeholder="https://..." inputMode="url" />
          </div>

          <div>
            <label className="block text-zinc-400 text-xs mb-1.5">
              Скріншоти <span className="text-zinc-600">— необовʼязково, до 15 МБ</span>
            </label>
            <label className="inline-block px-3 py-1.5 rounded-lg text-xs bg-zinc-800 text-zinc-300 hover:bg-zinc-700 cursor-pointer transition-colors">
              {uploading ? 'Завантаження...' : '＋ Додати файл'}
              {/* image/* covers HEIC from an iPhone; naming formats explicitly
                  would hide the camera option on some phones */}
              <input type="file" multiple accept="image/*,.pdf,application/pdf" className="hidden"
                     onChange={e => { void upload(e.target.files); e.target.value = '' }} />
            </label>

            {files.length > 0 && (
              <ul className="mt-2 space-y-1">
                {files.map(f => (
                  <li key={f.path} className="flex items-center gap-2 text-xs">
                    <a href={`/api/requests/files?path=${encodeURIComponent(f.path)}`}
                       target="_blank" rel="noreferrer"
                       className="text-zinc-300 hover:text-white truncate flex-1">
                      {f.name}
                    </a>
                    <span className="text-zinc-600">{Math.round(f.size / 1024)} КБ</span>
                    <button onClick={() => setFiles(list => list.filter(x => x.path !== f.path))}
                            className="text-zinc-600 hover:text-red-400">×</button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error && <p className="text-red-400 text-xs">{error}</p>}

          <button
            onClick={submit}
            disabled={!enough || saving || uploading}
            className="w-full px-4 py-2.5 rounded-lg text-sm bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white font-medium transition-colors"
          >
            {saving ? 'Збереження...' : target === 'done' ? 'Закрити запит' : 'Надіслати на підтвердження'}
          </button>
        </div>
      </div>
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
  const [assignees, setAssignees] = useState<string[]>([])
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

  const toggleAssignee = (id: string) =>
    setAssignees(list => list.includes(id) ? list.filter(x => x !== id) : [...list, id])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setOk('')

    const finalSubject = isCustom ? customSubject.trim() : subject
    if (!assignees.length) return setError('Оберіть хоча б одного виконавця')
    if (!finalSubject) return setError('Вкажіть суть запиту')

    setSaving(true)
    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignees,
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
      setDescription(''); setDeadline(''); setCustomSubject('')
      setPriority('normal'); setAssignees([])
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

        <div>
          <label className={label}>
            Кому * {assignees.length > 0 && <span className="text-zinc-600">— обрано {assignees.length}</span>}
          </label>
          <PeoplePicker
            people={people}
            selected={assignees}
            onToggle={toggleAssignee}
            meId={me.id}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
          <div>
            <label className={label}>Дедлайн</label>
            <DateInput value={deadline} onChange={setDeadline} className={field} />
          </div>
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

// --- Journal --------------------------------------------------------------

function Journal({ request: r }: { request: WorkRequest }) {
  const [open, setOpen] = useState(false)
  const events = r.events ?? []

  return (
    <div className="border border-zinc-800 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 bg-zinc-800/40 hover:bg-zinc-800/70 transition-colors"
      >
        <span className="text-zinc-300 text-xs font-medium">
          Журнал {events.length > 0 && <span className="text-zinc-600">({events.length})</span>}
        </span>
        <span className="text-zinc-500 text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="max-h-64 overflow-y-auto divide-y divide-zinc-800/60">
          {events.length === 0 ? (
            <div className="px-3 py-4 text-center text-zinc-600 text-xs">Записів немає</div>
          ) : (
            events.map(e => {
              const meta = EVENT_META[e.type as RequestEventType]
              const from = eventValue(e.type, e.old_value)
              const to = eventValue(e.type, e.new_value)
              return (
                <div key={e.id} className="px-3 py-2 flex gap-2.5">
                  <span className="text-zinc-600 text-xs mt-0.5 shrink-0">{meta?.icon ?? '•'}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs">
                      <span className="text-zinc-300">{name(e.actor)}</span>{' '}
                      <span className="text-zinc-500">{meta?.label ?? e.type}</span>
                    </div>
                    {(from || to) && e.type !== 'created' && (
                      <div className="text-zinc-500 text-xs mt-0.5 break-words">
                        {from && <span className="line-through text-zinc-600">{from}</span>}
                        {from && to && ' → '}
                        {to && <span className="text-zinc-400">{to}</span>}
                      </div>
                    )}
                    <div className="text-zinc-600 text-xs mt-0.5">{fmtDateTime(e.created_at)}</div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

// --- Detail modal ---------------------------------------------------------

function DetailModal({ request: r, me, people, isAdmin, busy, onClose, onPatch, onDelete, onNoteAdded }: {
  request: WorkRequest
  me: Person
  people: Person[]
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
  const [editingPeople, setEditingPeople] = useState(false)
  const [draftAssignees, setDraftAssignees] = useState<string[]>(r.assignees.map(a => a.id))

  const isAuthor = r.created_by === me.id
  const isAssignee = r.assignees.some(a => a.id === me.id)
  const canEdit = isAuthor || isAssignee || isAdmin
  const canDelete = isAuthor
  const dl = deadlineState(r.deadline, r.status)
  const notes = r.notes ?? []

  // The assignee drives the work; the author only cancels — closing and rework
  // happen through the decision buttons below the dropdown
  const statusOptions = statusOptionsFor({ isAuthor, isAssignee, current: r.status })
  const awaitingMyDecision = r.status === 'pending_review' && isAuthor
  const [resolveTo, setResolveTo] = useState<RequestStatus | null>(null)

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
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <PersonChip person={r.author} label="Поставив:" />
              <span className="text-zinc-600 text-xs">{fmtDateTime(r.created_at)}</span>
            </div>
            <div className="text-zinc-500 text-xs mt-1.5">
              Кому: <span className="text-zinc-300">{r.assignees.map(a => name(a)).join(', ') || '—'}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-xl leading-none px-1">×</button>
        </div>

        <div className="p-5 space-y-5">
          {r.status === 'pending_review' && !isAuthor && (
            <div className="bg-zinc-800/40 border border-zinc-700 rounded-lg px-4 py-2.5 text-zinc-400 text-xs">
              Надіслано на підтвердження — очікує рішення {name(r.author)}
            </div>
          )}

          {r.description && (
            <div>
              <div className="text-zinc-400 text-xs mb-1.5">Опис</div>
              <div className="text-zinc-200 text-sm whitespace-pre-wrap bg-zinc-800/40 rounded-lg px-3 py-2.5">
                {r.description}
              </div>
            </div>
          )}

          {/* The author decides from this, so it sits above the status control
              rather than at the bottom of the modal */}
          {r.resolution && (
            <div>
              <div className="text-zinc-400 text-xs mb-1.5">
                Що зроблено
                {r.resolved_at && (
                  <span className="text-zinc-600"> · {timeAgo(r.resolved_at)}</span>
                )}
              </div>
              <div className="bg-emerald-950/20 border border-emerald-900/40 rounded-lg px-3 py-2.5 space-y-2">
                <div className="text-zinc-200 text-sm whitespace-pre-wrap">{r.resolution}</div>

                {r.resolution_url && (
                  <a href={r.resolution_url} target="_blank" rel="noreferrer"
                     className="block text-cyan-400 hover:text-cyan-300 text-xs truncate">
                    {r.resolution_url}
                  </a>
                )}

                {!!r.resolution_files?.length && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {r.resolution_files.map(f => (
                      <a key={f.path}
                         href={`/api/requests/files?path=${encodeURIComponent(f.path)}`}
                         target="_blank" rel="noreferrer"
                         className="px-2 py-1 rounded bg-zinc-800 text-zinc-300 hover:text-white text-xs">
                        ▤ {f.name}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <div className="text-zinc-400 text-xs mb-1.5">Статус</div>
              <select
                value={r.status}
                disabled={!canEdit || busy || statusOptions.length < 2}
                onChange={e => {
                  const next = e.target.value as RequestStatus
                  // Finishing work needs a description. Asking for it here is
                  // the same ask the Виконано button makes — sending the change
                  // first and reporting the refusal afterwards is what turned
                  // it into an alert about a field the person never saw.
                  if (RESOLUTION_REQUIRED_STATUSES.includes(next)) setResolveTo(next)
                  else void onPatch(r.id, { status: next })
                }}
                className={`${control} w-full`}
              >
                {statusOptions.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
              </select>
            </div>
            <div>
              <div className="text-zinc-400 text-xs mb-1.5">
                Пріоритет {!isAuthor && <span className="text-zinc-600">(лише автор)</span>}
              </div>
              <select
                value={r.priority}
                disabled={!isAuthor || busy}
                onChange={e => onPatch(r.id, { priority: e.target.value })}
                className={`${control} w-full`}
                title={isAuthor ? undefined : 'Пріоритет змінює лише той, хто поставив запит'}
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

          {awaitingMyDecision && (
            <div className="bg-purple-950/30 border border-purple-900/60 rounded-lg px-4 py-3">
              <div className="text-purple-200 text-sm mb-2.5">
                Виконавець надіслав запит на підтвердження.
              </div>
              <div className="flex gap-2 flex-wrap">
                <button
                  disabled={busy}
                  onClick={() => onPatch(r.id, { status: 'done' })}
                  className="px-3 py-1.5 rounded-lg text-xs bg-emerald-900/60 text-emerald-300 hover:bg-emerald-800/60 disabled:opacity-50 transition-colors"
                >
                  ✓ Підтвердити виконання
                </button>
                <button
                  disabled={busy}
                  onClick={() => onPatch(r.id, { status: 'rework' })}
                  className="px-3 py-1.5 rounded-lg text-xs bg-orange-950/60 text-orange-400 hover:bg-orange-900/60 disabled:opacity-50 transition-colors"
                >
                  ↩ Надіслати на доопрацювання
                </button>
              </div>
            </div>
          )}

          <div className={`text-xs ${DEADLINE_TONE[dl.tone]}`}>◷ {dl.label}</div>

          {/* Reassignment stays with the author */}
          {isAuthor && (
            <div>
              <button
                type="button"
                onClick={() => { setEditingPeople(o => !o); setDraftAssignees(r.assignees.map(a => a.id)) }}
                className="text-zinc-400 hover:text-white text-xs transition-colors"
              >
                {editingPeople ? '× Скасувати' : '✎ Змінити виконавців'}
              </button>
              {editingPeople && (
                <div className="mt-2 space-y-2">
                  <PeoplePicker
                    people={people}
                    selected={draftAssignees}
                    onToggle={id => setDraftAssignees(l =>
                      l.includes(id) ? l.filter(x => x !== id) : [...l, id])}
                    meId={me.id}
                  />
                  <button
                    type="button"
                    disabled={busy || draftAssignees.length === 0}
                    onClick={async () => {
                      await onPatch(r.id, { assignees: draftAssignees })
                      setEditingPeople(false)
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white transition-colors"
                  >
                    Зберегти виконавців
                  </button>
                </div>
              )}
            </div>
          )}

          <Journal request={r} />

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

      {resolveTo && (
        <ResolutionDialog
          request={r}
          target={resolveTo as 'done' | 'pending_review'}
          onClose={() => setResolveTo(null)}
          onDone={async payload => {
            await onPatch(r.id, payload)
            setResolveTo(null)
          }}
        />
      )}
    </div>
  )
}

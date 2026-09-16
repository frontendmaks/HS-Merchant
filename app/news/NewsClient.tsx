'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ROLE_LABELS, type UserRole } from '@/lib/roles'
import { AUDIENCE_ROLES, NEWS_STATUS_META, type NewsStatus } from '@/lib/news'
import Editor from './Editor'

interface Person { full_name: string | null; email: string | null }

interface NewsItem {
  id: string
  title: string
  body: string
  audience: string[]
  status: NewsStatus
  published_at: string | null
  created_at: string
  author: Person | Person[] | null
}

const one = (p: Person | Person[] | null) => (Array.isArray(p) ? p[0] ?? null : p)
const who = (p: Person | Person[] | null) => {
  const x = one(p)
  return x?.full_name?.trim() || x?.email || '—'
}
const when = (iso: string) =>
  new Date(iso).toLocaleString('uk-UA', {
    day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })

export default function NewsClient({ news, readIds, canWrite, role }: {
  news: NewsItem[]
  readIds: string[]
  canWrite: boolean
  role: UserRole
}) {
  const router = useRouter()
  const [editing, setEditing] = useState<NewsItem | 'new' | null>(null)
  const [opened, setOpened] = useState<Set<string>>(new Set(readIds))
  const [busy, setBusy] = useState(false)

  async function markRead(id: string) {
    if (opened.has(id)) return
    setOpened(prev => new Set(prev).add(id))
    await fetch(`/api/news/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: true }),
    })
  }

  async function remove(id: string) {
    if (!window.confirm('Видалити новину? Це не можна скасувати.')) return
    setBusy(true)
    await fetch(`/api/news/${id}`, { method: 'DELETE' })
    setBusy(false)
    router.refresh()
  }

  const unread = news.filter(n => n.status === 'published' && !opened.has(n.id)).length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">Новини</h1>
          <p className="text-zinc-400 text-sm mt-0.5">
            Зміни й нововведення в роботі
            {unread > 0 && <span className="text-red-400"> · {unread} непрочитаних</span>}
          </p>
        </div>
        {canWrite && (
          <button
            onClick={() => setEditing('new')}
            className="bg-red-600 hover:bg-red-500 text-white text-sm font-medium
                       px-4 py-2 rounded-lg transition-colors"
          >
            Написати новину
          </button>
        )}
      </div>

      {news.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-12 text-center text-zinc-500 text-sm">
          Новин поки немає
        </div>
      ) : (
        <div className="space-y-4">
          {news.map(n => {
            const isNew = n.status === 'published' && !opened.has(n.id)
            return (
              <Article
                key={n.id}
                id={n.id}
                onSeen={() => markRead(n.id)}
                className={`bg-zinc-900 border rounded-xl overflow-hidden transition-colors ${
                  isNew ? 'border-red-900/70' : 'border-zinc-800'
                }`}
              >
                <div className="px-5 py-4 border-b border-zinc-800">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {isNew && (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-600 text-white">
                            Нове
                          </span>
                        )}
                        {n.status === 'draft' && (
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${NEWS_STATUS_META.draft.badge}`}>
                            {NEWS_STATUS_META.draft.label}
                          </span>
                        )}
                        <h2 className="text-white font-semibold">{n.title}</h2>
                      </div>
                      <p className="text-zinc-500 text-xs mt-1">
                        {who(n.author)} · {when(n.published_at ?? n.created_at)}
                        {canWrite && n.audience.length > 0 && (
                          <span className="text-zinc-600">
                            {' · для: '}
                            {n.audience.map(r => ROLE_LABELS[r] ?? r).join(', ')}
                          </span>
                        )}
                      </p>
                    </div>
                    {canWrite && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => setEditing(n)}
                          className="text-zinc-400 hover:text-white text-xs px-2 py-1 transition-colors"
                        >
                          Редагувати
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => remove(n.id)}
                          className="text-zinc-600 hover:text-red-400 text-xs px-2 py-1 transition-colors"
                        >
                          Видалити
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Sanitised on the way in — see lib/news-html.ts */}
                <div
                  className="news-body px-5 py-4 text-zinc-300 text-sm"
                  dangerouslySetInnerHTML={{ __html: n.body }}
                />
              </Article>
            )
          })}
        </div>
      )}

      {editing && (
        <Compose
          item={editing === 'new' ? null : editing}
          role={role}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); router.refresh() }}
        />
      )}
    </div>
  )
}

/**
 * One announcement, which counts as read once it has actually been on screen.
 *
 * Hovering was the obvious trigger and the wrong one: it never fires on a
 * phone, where most of these will be read, and on a desktop it marks things
 * read that the mouse merely crossed on its way somewhere else.
 */
function Article({ id, onSeen, className, children }: {
  id: string
  onSeen: () => void
  className: string
  children: React.ReactNode
}) {
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) {
        onSeen()
        io.disconnect()
      }
    }, { threshold: 0.25 })
    io.observe(el)
    return () => io.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  return <article ref={ref} id={id} className={className}>{children}</article>
}

/** Writing or editing one piece. */
function Compose({ item, role, onClose, onDone }: {
  item: NewsItem | null
  role: UserRole
  onClose: () => void
  onDone: () => void
}) {
  const [title, setTitle] = useState(item?.title ?? '')
  const [body, setBody] = useState(item?.body ?? '')
  const [audience, setAudience] = useState<string[]>(
    item?.audience ?? ['super_admin', 'admin', 'manager', 'operator', 'viewer'],
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const toggle = (r: string) => setAudience(prev =>
    prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r])

  async function save(publish: boolean) {
    setError('')
    setSaving(true)
    try {
      const res = await fetch(item ? `/api/news/${item.id}` : '/api/news', {
        method: item ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body, audience, publish }),
      })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!data.ok) throw new Error(data.error || 'Не вдалося зберегти')
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const alreadyOut = item?.status === 'published'

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center p-4 overflow-y-auto"
         onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-3xl my-8"
           onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
          <h2 className="text-white font-semibold">
            {item ? 'Редагувати новину' : 'Нова новина'}
          </h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-4">
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Заголовок"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5
                       text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:border-red-500"
          />

          <Editor value={body} onChange={setBody} />

          <div>
            <div className="text-zinc-400 text-xs mb-2">
              Кому адресовано — ці ролі отримають сповіщення
            </div>
            <div className="flex flex-wrap gap-2">
              {AUDIENCE_ROLES.map(r => (
                <button
                  key={r}
                  type="button"
                  onClick={() => toggle(r)}
                  className={`px-3 py-1.5 rounded-lg text-xs transition-colors border ${
                    audience.includes(r)
                      ? 'bg-red-600 border-red-600 text-white'
                      : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white'
                  }`}
                >
                  {ROLE_LABELS[r] ?? r}
                </button>
              ))}
            </div>
            {/* Said plainly, because the two rules differ and the difference
                is the thing people get wrong about this screen */}
            <p className="text-zinc-600 text-xs mt-2">
              Керівництво бачить усі новини незалежно від цього вибору.
              {role && ' Сповіщення отримають лише обрані ролі.'}
            </p>
          </div>

          {error && <div className="text-red-400 text-xs">{error}</div>}
        </div>

        <div className="px-5 py-4 border-t border-zinc-800 flex items-center justify-end gap-2">
          <button
            disabled={saving}
            onClick={() => save(false)}
            className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-300
                       text-sm px-4 py-2 rounded-lg transition-colors"
          >
            {alreadyOut ? 'Зняти з публікації' : 'Зберегти чернетку'}
          </button>
          <button
            disabled={saving || !title.trim() || audience.length === 0}
            onClick={() => save(true)}
            className="bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed
                       text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {saving ? 'Збереження…' : alreadyOut ? 'Зберегти' : 'Опублікувати'}
          </button>
        </div>
      </div>
    </div>
  )
}

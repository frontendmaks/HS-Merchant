'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

interface Notification {
  id: string
  type: string
  title: string
  body: string | null
  is_read: boolean
  created_at: string
  request_id: string | null
}

const POLL_MS = 20_000

const ICONS: Record<string, string> = {
  request_created:  '✚',
  request_status:   '✓',
  request_deadline: '◷',
  request_note:     '✎',
  request_updated:  '↻',
}

function ago(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (mins < 1) return 'щойно'
  if (mins < 60) return `${mins} хв тому`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} год тому`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} дн тому`
  return new Date(iso).toLocaleDateString('uk-UA')
}

export default function NotificationBell({ enabled }: { enabled: boolean }) {
  const router = useRouter()
  const [items, setItems] = useState<Notification[]>([])
  const [unread, setUnread] = useState(0)
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications')
      if (!res.ok) return
      const data = await res.json() as { notifications: Notification[]; unread: number }
      setItems(data.notifications)
      setUnread(data.unread)
    } catch { /* offline — try again on the next tick */ }
  }, [])

  useEffect(() => {
    if (!enabled) return
    load()
    const timer = setInterval(load, POLL_MS)
    // Catch up immediately when the tab comes back into focus
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => { clearInterval(timer); window.removeEventListener('focus', onFocus) }
  }, [enabled, load])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  async function markRead(id: string) {
    setItems(list => list.map(n => n.id === id ? { ...n, is_read: true } : n))
    setUnread(u => Math.max(0, u - 1))
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
  }

  async function markAll() {
    setItems(list => list.map(n => ({ ...n, is_read: true })))
    setUnread(0)
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    })
  }

  async function openNotification(n: Notification) {
    if (!n.is_read) await markRead(n.id)
    setOpen(false)
    if (n.request_id) router.push('/requests')
  }

  if (!enabled) return null

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
      >
        <span className="text-base relative">
          ◔
          {unread > 0 && (
            <span className="absolute -top-1 -right-1.5 min-w-[15px] h-[15px] px-1 rounded-full bg-red-600 text-white text-[10px] font-semibold flex items-center justify-center">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </span>
        Сповіщення
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-80 max-h-[420px] bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden flex flex-col z-50">
          <div className="px-3.5 py-2.5 border-b border-zinc-800 flex items-center justify-between">
            <span className="text-white text-sm font-medium">Сповіщення</span>
            {unread > 0 && (
              <button
                onClick={markAll}
                className="text-xs text-zinc-400 hover:text-white transition-colors"
              >
                Прочитати всі
              </button>
            )}
          </div>

          <div className="overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-8 text-center text-zinc-600 text-sm">Сповіщень немає</div>
            ) : (
              items.map(n => (
                <button
                  key={n.id}
                  onClick={() => openNotification(n)}
                  className={`w-full text-left px-3.5 py-2.5 border-b border-zinc-800/60 last:border-0 hover:bg-zinc-800/40 transition-colors ${
                    n.is_read ? '' : 'bg-zinc-800/20'
                  }`}
                >
                  <div className="flex gap-2.5">
                    <span className={`text-sm shrink-0 mt-0.5 ${n.is_read ? 'text-zinc-600' : 'text-red-400'}`}>
                      {ICONS[n.type] ?? '•'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className={`text-xs ${n.is_read ? 'text-zinc-400' : 'text-white font-medium'}`}>
                        {n.title}
                      </div>
                      {n.body && (
                        <div className="text-zinc-500 text-xs mt-0.5 line-clamp-2">{n.body}</div>
                      )}
                      <div className="text-zinc-600 text-xs mt-1">{ago(n.created_at)}</div>
                    </div>
                    {!n.is_read && (
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0 mt-1.5" />
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

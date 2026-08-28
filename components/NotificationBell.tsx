'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'

interface Notification {
  id: string
  type: string
  title: string
  body: string | null
  is_read: boolean
  created_at: string
  request_id: string | null
  link: string | null
}

const POLL_MS = 20_000
const SOUND_KEY = 'hs-notify-sound'
const BASE_TITLE = 'HS Merchant'

const ICONS: Record<string, string> = {
  request_created:  '✚',
  request_status:   '✓',
  request_deadline: '◷',
  request_note:     '✎',
  request_updated:  '↻',
  request_review:   '⏳',
  order_new:        '🛒',
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

// --- Sound ----------------------------------------------------------------
// Synthesised so there is no audio asset to ship or fail to load.
let audioCtx: AudioContext | null = null

function chime() {
  try {
    const Ctor = window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    audioCtx ??= new Ctor()
    // Browsers suspend the context until the page has been interacted with
    if (audioCtx.state === 'suspended') void audioCtx.resume()

    const ctx = audioCtx
    const now = ctx.currentTime
    const gain = ctx.createGain()
    gain.connect(ctx.destination)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.2, now + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5)

    // Two rising notes — short and distinct from system sounds
    ;[880, 1174.7].forEach((freq, i) => {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = freq
      osc.connect(gain)
      osc.start(now + i * 0.13)
      osc.stop(now + i * 0.13 + 0.2)
    })
  } catch { /* audio unavailable — the visual badge still shows */ }
}

export default function NotificationBell({ enabled }: { enabled: boolean }) {
  const router = useRouter()
  const [items, setItems] = useState<Notification[]>([])
  const [unread, setUnread] = useState(0)
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({})
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default')
  const [soundOn, setSoundOn] = useState(true)
  const panelRef = useRef<HTMLDivElement>(null)

  // Ids already seen by this tab — stops the whole backlog firing on first load
  const known = useRef<Set<string> | null>(null)

  useEffect(() => {
    setPermission(typeof window !== 'undefined' && 'Notification' in window
      ? window.Notification.permission
      : 'unsupported')
    setSoundOn(localStorage.getItem(SOUND_KEY) !== 'off')
  }, [])

  /** Desktop banner — reaches the user in any window, even another app. */
  const popDesktop = useCallback((list: Notification[]) => {
    if (typeof window === 'undefined' || !('Notification' in window)) return
    if (window.Notification.permission !== 'granted') return

    for (const n of list.slice(0, 3)) {
      try {
        const notif = new window.Notification(n.title, {
          body: n.body ?? undefined,
          icon: '/logo.svg',
          badge: '/logo.svg',
          tag: n.id,          // same id never stacks twice
        })
        notif.onclick = () => {
          window.focus()
          const target = n.link ?? (n.request_id ? '/requests' : null)
          if (target) router.push(target)
          notif.close()
        }
      } catch { /* banner blocked — badge and sound still fire */ }
    }
  }, [router])

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications')
      if (!res.ok) return
      const data = await res.json() as { notifications: Notification[]; unread: number }

      const fresh = data.notifications.filter(n => !n.is_read && !known.current?.has(n.id))
      const firstLoad = known.current === null

      known.current = new Set(data.notifications.map(n => n.id))
      setItems(data.notifications)
      setUnread(data.unread)

      // Only announce what arrived while this tab was already running
      if (!firstLoad && fresh.length > 0) {
        popDesktop(fresh)
        if (localStorage.getItem(SOUND_KEY) !== 'off') chime()
      }
    } catch { /* offline — retry on the next tick */ }
  }, [popDesktop])

  useEffect(() => {
    if (!enabled) return
    load()
    const timer = setInterval(load, POLL_MS)
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => { clearInterval(timer); window.removeEventListener('focus', onFocus) }
  }, [enabled, load])

  // Unread count in the tab title, for when the app sits in a background tab
  useEffect(() => {
    if (!enabled) return
    document.title = unread > 0 ? `(${unread}) ${BASE_TITLE}` : BASE_TITLE
    return () => { document.title = BASE_TITLE }
  }, [unread, enabled])

  useEffect(() => {
    if (!open) return
    // pointerdown, not mousedown: a phone reports a tap as a pointer event, so
    // the panel would never close by tapping outside it
    const onDown = (e: Event) => {
      const t = e.target as Node
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  /**
   * Positions the panel against the viewport instead of its parent.
   *
   * In the sidebar the bell sits at the bottom and the list belongs above it.
   * On a phone the bell is in a 56px top bar, where opening upwards puts the
   * whole panel off the screen — which is why it could not be opened at all.
   * So the side is chosen from where there is room, and a narrow screen gets a
   * panel that fits it rather than a fixed 320px box hanging off the edge.
   */
  const place = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const width = Math.min(320, vw - 16)
    const below = vh - r.bottom

    setPanelStyle({
      width,
      left: Math.min(Math.max(8, r.left), Math.max(8, vw - width - 8)),
      ...(below > r.top
        ? { top: r.bottom + 8, maxHeight: Math.max(220, below - 16) }
        : { bottom: vh - r.top + 8, maxHeight: Math.max(220, r.top - 16) }),
    })
  }, [])

  useEffect(() => {
    if (!open) return
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, place])

  async function askPermission() {
    if (!('Notification' in window)) return
    const result = await window.Notification.requestPermission()
    setPermission(result)
    if (result === 'granted') {
      chime()
      new window.Notification('Сповіщення увімкнено', {
        body: 'Ви бачитимете нові запити навіть в іншому вікні.',
        icon: '/logo.svg',
      })
    }
  }

  function toggleSound() {
    const next = !soundOn
    setSoundOn(next)
    localStorage.setItem(SOUND_KEY, next ? 'on' : 'off')
    if (next) chime()
  }

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

  const targetOf = (n: Notification) => n.link ?? (n.request_id ? '/requests' : null)

  async function openNotification(n: Notification) {
    if (!n.is_read) await markRead(n.id)
    setOpen(false)
    const target = targetOf(n)
    if (target) router.push(target)
  }

  if (!enabled) return null

  return (
    <>
      <button
        ref={triggerRef}
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

      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={panelRef}
          style={panelStyle}
          // Fixed and portalled: the phone's top bar is 56px tall and would
          // clip the panel away entirely
          className="fixed bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden flex flex-col z-[100]"
        >
          <div className="px-3.5 py-2.5 border-b border-zinc-800 flex items-center justify-between">
            <span className="text-white text-sm font-medium">Сповіщення</span>
            <div className="flex items-center gap-2">
              <button
                onClick={toggleSound}
                title={soundOn ? 'Вимкнути звук' : 'Увімкнути звук'}
                className="text-xs text-zinc-400 hover:text-white transition-colors"
              >
                {soundOn ? '🔊' : '🔇'}
              </button>
              {unread > 0 && (
                <button
                  onClick={markAll}
                  className="text-xs text-zinc-400 hover:text-white transition-colors"
                >
                  Прочитати всі
                </button>
              )}
            </div>
          </div>

          {/* Desktop banners need an explicit opt-in from the browser */}
          {permission === 'default' && (
            <button
              onClick={askPermission}
              className="px-3.5 py-2.5 border-b border-zinc-800 bg-red-950/30 hover:bg-red-950/50 text-left transition-colors"
            >
              <div className="text-red-300 text-xs font-medium">Увімкнути сповіщення на компʼютері</div>
              <div className="text-zinc-500 text-xs mt-0.5">
                Бачитимете нові запити, навіть коли працюєте в іншому вікні
              </div>
            </button>
          )}
          {permission === 'denied' && (
            <div className="px-3.5 py-2 border-b border-zinc-800 text-zinc-500 text-xs">
              Сповіщення заблоковані в браузері — увімкніть їх у налаштуваннях сайту
            </div>
          )}

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
        </div>,
        document.body,
      )}
    </>
  )
}

'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { useEffect, useState } from 'react'
import { PAGE_ROLES, ROLE_LABELS } from '@/lib/roles'
import { usePresence } from '@/lib/presence'
import NotificationBell from '@/components/NotificationBell'

// Access per nav item comes from lib/roles.ts, shared with the page guards
const nav = [
  { href: '/',         label: 'Дашборд',       icon: '▦', roles: PAGE_ROLES.dashboard },
  { href: '/products', label: 'Товари',         icon: '◈', roles: PAGE_ROLES.products },
  { href: '/feeds',    label: 'Фіди',           icon: '⊞', roles: PAGE_ROLES.feeds },
  { href: '/analytics', label: 'Аналітика',     icon: '◑', roles: PAGE_ROLES.analytics },
  { href: '/syncs',    label: 'Синхронізації',  icon: '↻', roles: PAGE_ROLES.syncs },
  { href: '/orders',   label: 'Замовлення',     icon: '◷', roles: PAGE_ROLES.orders },
  { href: '/requests', label: 'Запити',         icon: '✉', roles: PAGE_ROLES.requests },
  { href: '/users',    label: 'Користувачі',    icon: '◉', roles: PAGE_ROLES.users },
]

/** Sections with more than one page. Rendered as a collapsible group whose
 *  visibility follows the items left after the role filter. */
const groups = [
  {
    label: 'Оператори',
    icon: '☰',
    items: [
      { href: '/operators/schedule', label: 'Графік роботи', roles: PAGE_ROLES.schedule },
    ],
  },
]

interface Profile {
  full_name: string | null
  email: string
  role: string
}

interface NavCounts {
  requests: { new: number; inProgress: number }
  orders: { new: number; processing: number }
}

const COUNTS_POLL_MS = 30_000

/** Grey = waiting to be picked up, red = already being worked on. */
function NavBadge({ count, tone, title }: { count: number; tone: 'grey' | 'red'; title: string }) {
  if (count <= 0) return null
  return (
    <span
      title={title}
      className={`min-w-[20px] h-5 px-1.5 inline-flex items-center justify-center rounded-full text-[11px] font-semibold tabular-nums ${
        tone === 'red' ? 'bg-red-600 text-white' : 'bg-zinc-700 text-zinc-200'
      }`}
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}

/** A section that expands to its pages. Opens itself when one of them is the
 *  page you are on, so a reload never hides where you are. */
function NavGroup({ group, path, onNavigate }: {
  group: { label: string; icon: string; items: { href: string; label: string }[] }
  path: string
  onNavigate: () => void
}) {
  const holdsCurrent = group.items.some(i => path === i.href || path.startsWith(i.href + '/'))
  const [open, setOpen] = useState(holdsCurrent)

  useEffect(() => { if (holdsCurrent) setOpen(true) }, [holdsCurrent])

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
          holdsCurrent && !open
            ? 'text-white bg-zinc-800/60'
            : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
        }`}
      >
        <span className="text-base">{group.icon}</span>
        <span className="flex-1 text-left">{group.label}</span>
        <span className={`text-[10px] text-zinc-500 transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
      </button>

      {open && (
        <div className="mt-1 ml-4 pl-3 border-l border-zinc-800 space-y-1">
          {group.items.map(item => {
            const active = path === item.href || path.startsWith(item.href + '/')
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                className={`block px-3 py-2 rounded-lg text-sm transition-colors ${
                  active ? 'bg-red-600 text-white' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                }`}
              >
                {item.label}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function Sidebar() {
  const path = usePathname()
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [open, setOpen] = useState(false)
  const [counts, setCounts] = useState<NavCounts | null>(null)

  // Marks this user online on every page for as long as the tab is open
  usePresence(userId)

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!session) { setUserId(null); setLoaded(true); return }
      setUserId(session.user.id)
      const { data } = await supabase
        .from('profiles')
        .select('full_name,email,role')
        .eq('id', session.user.id)
        .single()
      setProfile(data ?? { full_name: null, email: session.user.email || '', role: 'viewer' })
      setLoaded(true)
    })
    return () => subscription.unsubscribe()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Badge figures: polled, and re-read on navigation so acting on a request or
  // order updates the count as soon as you leave the page.
  useEffect(() => {
    let alive = true
    const load = async () => {
      if (!userId) { if (alive) setCounts(null); return }
      try {
        const res = await fetch('/api/nav-counts')
        if (!res.ok) return
        const data = await res.json()
        if (alive) setCounts(data)
      } catch {
        // A failed poll just leaves the previous figures on screen
      }
    }
    void load()
    const timer = setInterval(load, COUNTS_POLL_MS)
    return () => { alive = false; clearInterval(timer) }
  }, [userId, path])

  // Escape closes the drawer, matching the backdrop tap.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  if (path === '/login' || path === '/set-password') return null

  const role = profile?.role
  const visibleNav = loaded && role
    ? nav.filter(item => (item.roles as readonly string[]).includes(role))
    : []

  const visibleGroups = loaded && role
    ? groups
        .map(g => ({ ...g, items: g.items.filter(i => (i.roles as readonly string[]).includes(role)) }))
        .filter(g => g.items.length > 0)
    : []

  return (
    <>
      {/* Mobile top bar — the only way to reach the nav below lg */}
      <header className="lg:hidden fixed top-0 inset-x-0 z-40 h-14 bg-zinc-900 border-b border-zinc-800 flex items-center gap-3 px-4">
        <button
          onClick={() => setOpen(true)}
          aria-label="Відкрити меню"
          aria-expanded={open}
          className="w-9 h-9 -ml-1 flex flex-col items-center justify-center gap-[3px] rounded-lg text-zinc-300 hover:bg-zinc-800 transition-colors"
        >
          <span className="block w-4 h-px bg-current" />
          <span className="block w-4 h-px bg-current" />
          <span className="block w-4 h-px bg-current" />
        </button>
        <img src="/logo.svg" alt="" className="w-7 h-7 rounded-full" />
        <span className="text-white font-semibold text-sm">HS Merchant</span>
        <div className="ml-auto">
          <NotificationBell enabled={loaded && !!profile} />
        </div>
      </header>

      {/* Backdrop — only rendered while the drawer is open */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          className="lg:hidden fixed inset-0 z-40 bg-black/60"
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed top-0 left-0 z-50 h-screen w-60 bg-zinc-900 border-r border-zinc-800 flex flex-col transition-transform duration-200 ease-out ${
          open ? 'translate-x-0' : '-translate-x-full'
        } lg:translate-x-0`}
      >
      {/* Logo */}
      <div className="px-6 py-5 border-b border-zinc-800 flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <img src="/logo.svg" alt="Галицька Свіжина" className="w-9 h-9 rounded-full shrink-0" />
          <div className="min-w-0">
            <div className="text-white font-semibold text-sm leading-tight truncate">HS Merchant</div>
            <div className="text-zinc-500 text-xs truncate">Агрегатор фідів</div>
          </div>
        </div>
        <button
          onClick={() => setOpen(false)}
          aria-label="Закрити меню"
          className="lg:hidden w-8 h-8 shrink-0 flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
        >
          ✕
        </button>
      </div>

      {/* Nav — scrolls on short screens (e.g. phone in landscape) */}
      <nav className="flex-1 min-h-0 overflow-y-auto px-3 py-4 space-y-1">
        {visibleNav.map(({ href, label, icon }) => {
          const active = path === href
          const badges = href === '/requests'
            ? [
                { count: counts?.requests.new ?? 0,        tone: 'grey' as const, title: 'Не взяті в роботу' },
                { count: counts?.requests.inProgress ?? 0, tone: 'red'  as const, title: 'В роботі' },
              ]
            : href === '/orders'
            ? [
                { count: counts?.orders.new ?? 0,        tone: 'grey' as const, title: 'Нові' },
                { count: counts?.orders.processing ?? 0, tone: 'red'  as const, title: 'Опрацьовуються' },
              ]
            : []
          return (
            <Link
              key={href}
              href={href}
              // Closes the drawer on tap, so it does not stay over the page it opened
              onClick={() => setOpen(false)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                active
                  ? 'bg-red-600 text-white'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
              }`}
            >
              <span className="text-base">{icon}</span>
              <span className="flex-1 min-w-0 truncate">{label}</span>
              {badges.length > 0 && (
                <span className="flex items-center gap-1 shrink-0">
                  {badges.map(b => (
                    <NavBadge key={b.title} count={b.count} tone={b.tone} title={b.title} />
                  ))}
                </span>
              )}
            </Link>
          )
        })}

        {visibleGroups.map(group => (
          <NavGroup
            key={group.label}
            group={group}
            path={path}
            onNavigate={() => setOpen(false)}
          />
        ))}
      </nav>

      {/* User info + sign out */}
      <div className="px-3 py-4 border-t border-zinc-800 space-y-2 shrink-0">
        {/* Below lg the bell lives in the mobile top bar instead */}
        <div className="hidden lg:block">
          <NotificationBell enabled={loaded && !!profile} />
        </div>
        {loaded && profile && (
          <div className="px-3 py-2.5 rounded-lg bg-zinc-800/50">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-full bg-zinc-700 flex items-center justify-center text-zinc-300 text-xs font-semibold shrink-0">
                {(profile.full_name || profile.email).slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-white text-xs font-medium truncate">
                  {profile.full_name || profile.email}
                </div>
                <div className="text-zinc-500 text-xs truncate">
                  {ROLE_LABELS[profile.role] || profile.role}
                </div>
              </div>
            </div>
          </div>
        )}
        <button
          onClick={handleSignOut}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
        >
          <span>⎋</span>
          Вийти
        </button>
        <div className="px-3 text-zinc-700 text-xs">Галицька Свіжина © 2026</div>
      </div>
      </aside>
    </>
  )
}

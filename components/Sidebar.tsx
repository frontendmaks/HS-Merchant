'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { useEffect, useState } from 'react'

// Which roles can see each nav item
const nav = [
  { href: '/',         label: 'Дашборд',       icon: '▦', roles: ['super_admin','admin','viewer'] },
  { href: '/products', label: 'Товари',         icon: '◈', roles: ['super_admin','admin','viewer'] },
  { href: '/feeds',    label: 'Фіди',           icon: '⊞', roles: ['super_admin','admin','viewer'] },
  { href: '/syncs',    label: 'Синхронізації',  icon: '↻', roles: ['super_admin','admin'] },
  { href: '/orders',   label: 'Замовлення',     icon: '◷', roles: ['super_admin','admin','operator','viewer'] },
  { href: '/users',    label: 'Користувачі',    icon: '◉', roles: ['super_admin','admin'] },
]

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Супер адміністратор',
  admin:       'Адміністратор',
  operator:    'Оператор',
  viewer:      'Глядач',
}

interface Profile {
  full_name: string | null
  email: string
  role: string
}

export default function Sidebar() {
  const path = usePathname()
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loaded, setLoaded] = useState(false)

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { setLoaded(true); return }
      const { data } = await supabase
        .from('profiles')
        .select('full_name,email,role')
        .eq('id', user.id)
        .single()
      setProfile(data ?? { full_name: null, email: user.email || '', role: 'viewer' })
      setLoaded(true)
    })
  }, [])

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  if (path === '/login') return null

  const role = profile?.role ?? ''
  const visibleNav = loaded
    ? nav.filter(item => !role || item.roles.includes(role))
    : []

  return (
    <aside className="fixed top-0 left-0 h-screen w-60 bg-zinc-900 border-r border-zinc-800 flex flex-col">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <img src="/logo.svg" alt="Галицька Свіжина" className="w-9 h-9 rounded-full" />
          <div>
            <div className="text-white font-semibold text-sm leading-tight">HS Merchant</div>
            <div className="text-zinc-500 text-xs">Агрегатор фідів</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {visibleNav.map(({ href, label, icon }) => {
          const active = path === href
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                active
                  ? 'bg-red-600 text-white'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
              }`}
            >
              <span className="text-base">{icon}</span>
              {label}
            </Link>
          )
        })}
      </nav>

      {/* User info + sign out */}
      <div className="px-3 py-4 border-t border-zinc-800 space-y-2">
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
  )
}

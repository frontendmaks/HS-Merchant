'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const nav = [
  { href: '/',             label: 'Дашборд',      icon: '▦' },
  { href: '/products',     label: 'Товари',        icon: '◈' },
  { href: '/feeds',        label: 'Фіди',          icon: '⊞' },
  { href: '/marketplaces', label: 'Маркетплейси',  icon: '◎' },
  { href: '/orders',       label: 'Замовлення',    icon: '◷' },
]

export default function Sidebar() {
  const path = usePathname()
  return (
    <aside className="fixed top-0 left-0 h-screen w-60 bg-zinc-900 border-r border-zinc-800 flex flex-col">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-red-600 flex items-center justify-center text-white font-bold text-sm">ГС</div>
          <div>
            <div className="text-white font-semibold text-sm leading-tight">HS Merchant</div>
            <div className="text-zinc-500 text-xs">Агрегатор фідів</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {nav.map(({ href, label, icon }) => {
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

      {/* Footer */}
      <div className="px-6 py-4 border-t border-zinc-800">
        <div className="text-zinc-600 text-xs">Галицька Свіжина © 2026</div>
      </div>
    </aside>
  )
}

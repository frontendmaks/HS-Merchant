'use client'

import { useRouter } from 'next/navigation'
import { useTransition, useState } from 'react'

/**
 * Перемикач місяців.
 *
 * Був звичайним посиланням на серверну сторінку: клац — і нічого не
 * відбувається, поки сервер не віддасть усю сторінку. Півтори секунди тиші
 * читаються як «не натиснулось», тому люди клацали вдруге й втретє.
 *
 * useTransition дає те, чого бракувало: вкладка підсвічується одразу, видно,
 * що саме завантажується, а стара таблиця лишається на екрані, поки не
 * приїде нова.
 */
export default function MonthTabs({ tabs, selected }: {
  tabs: { value: string; label: string; href: string }[]
  selected: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [target, setTarget] = useState<string | null>(null)

  return (
    <div className="overflow-x-auto">
      <div className={`flex gap-1 min-w-max transition-opacity ${pending ? 'opacity-70' : ''}`}>
        {tabs.map(tab => {
          const active = tab.value === selected
          const loading = pending && target === tab.value
          return (
            <button
              key={tab.value}
              onClick={() => {
                if (active) return
                setTarget(tab.value)
                startTransition(() => router.push(tab.href))
              }}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors
                          whitespace-nowrap flex items-center gap-1.5 ${
                active || loading
                  ? 'bg-red-600 text-white'
                  : 'bg-zinc-800/50 text-zinc-400 hover:text-white hover:bg-zinc-800'
              }`}
            >
              {loading && (
                <span className="w-3 h-3 rounded-full border-2 border-white/70
                                 border-t-transparent animate-spin shrink-0" />
              )}
              {tab.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

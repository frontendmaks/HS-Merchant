'use client'

import { useState } from 'react'

/** Sync journals are long and rarely read in full — keep them folded away
 *  behind a header that still shows how many entries are inside. */
export default function CollapsibleLog({ title, count, children, defaultOpen = false }: {
  title: string
  count: number
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-4 px-6 py-3.5 hover:bg-zinc-800/40 transition-colors"
      >
        <span className="flex items-center gap-2.5 min-w-0">
          <span className="text-zinc-500 text-xs shrink-0">{open ? '▾' : '▸'}</span>
          <span className="text-sm font-medium text-white truncate">{title}</span>
          <span className="text-xs text-zinc-600 shrink-0">{count}</span>
        </span>
        <span className="text-xs text-zinc-500 shrink-0">
          {open ? 'Згорнути' : 'Розгорнути'}
        </span>
      </button>

      {/* The card clips its rounded corners, so the journal scrolls sideways in here */}
      {open && <div className="border-t border-zinc-800 overflow-x-auto">{children}</div>}
    </div>
  )
}

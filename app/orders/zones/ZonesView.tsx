'use client'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { colorFor } from '@/lib/zone-colors'
import ZonesMap, { type ZoneShape } from './ZonesMap'

export interface DayMap {
  kind: 'weekday' | 'sunday'
  label: string
  /** Звідки її беруть — щоб було видно, де саме правити межі */
  source: string
  sourceUrl: string
  updatedAt: string | null
  zones: ZoneShape[]
}

const when = (iso: string | null) => iso
  ? new Date(iso).toLocaleString('uk-UA', {
      timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit',
      hour: '2-digit', minute: '2-digit',
    })
  : 'ніколи'

/**
 * Дві карти доставки поруч.
 *
 * У будні місто ділять сім складів, у неділю — чотири, і межі при цьому
 * інші. Доти обидві карти жили лише в базі й у чужих редакторах: щоб
 * зрозуміти, чому адресі дістався цей склад, не було куди подивитись.
 *
 * Сьогоднішній день відкривається першим — найчастіше питають саме про
 * нього.
 */
export default function ZonesView({ maps, today }: { maps: DayMap[]; today: 'weekday' | 'sunday' }) {
  const router = useRouter()
  const [kind, setKind] = useState<'weekday' | 'sunday'>(today)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState('')
  const [pending, start] = useTransition()

  const map = maps.find(m => m.kind === kind) ?? maps[0]

  const warehouses = [...new Set(map.zones.map(z => z.warehouse))].sort()

  async function refresh() {
    setBusy(true)
    setSaid('')
    try {
      const r = await fetch('/api/zones/refresh', { method: 'POST' })
      const d = await r.json().catch(() => ({}))
      setSaid(r.ok ? (d.said ?? 'Оновлено') : (d.error ?? 'Не вдалося оновити'))
      if (r.ok) start(() => router.refresh())
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1">
          {maps.map(m => (
            <button key={m.kind} onClick={() => setKind(m.kind)}
              className={`px-3 h-11 lg:h-auto lg:py-1.5 rounded-lg text-xs transition-colors
                          whitespace-nowrap ${
                m.kind === kind ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'
              }`}>
              {m.label}
              {m.kind === today && <span className="ml-1.5 text-zinc-500">сьогодні</span>}
            </button>
          ))}
        </div>

        <button onClick={() => void refresh()} disabled={busy || pending}
          className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-white text-sm
                     px-3 h-11 lg:h-auto lg:py-2 rounded-lg transition-colors">
          {busy ? 'Оновлюємо…' : '↻ Оновити обидві карти'}
        </button>

        {said && <span className="text-zinc-400 text-xs">{said}</span>}
      </div>

      <div className="text-zinc-500 text-xs">
        Межі малюють тут:{' '}
        <a href={map.sourceUrl} target="_blank" rel="noreferrer"
          className="text-red-400 underline">{map.source}</a>
        {' · '}наша копія від {when(map.updatedAt)}
        {' · '}{map.zones.length} зон, {warehouses.length} складів
      </div>

      <ZonesMap zones={map.zones} />

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl divide-y divide-zinc-800/60">
        {map.zones.length === 0 ? (
          <div className="p-4 text-zinc-500 text-sm">
            Зон немає — натисніть «Оновити обидві карти»
          </div>
        ) : map.zones.map(z => (
          <div key={z.code} className="flex items-center gap-3 px-4 py-3 text-sm">
            <span className="w-3 h-3 rounded-sm shrink-0"
              style={{ background: colorFor(z.warehouse) }} />
            <span className="text-white flex-1 min-w-0 truncate">{z.warehouse}</span>
            <span className="text-zinc-500 text-xs">{z.code}</span>
            <span className="text-zinc-600 text-xs tabular-nums w-16 text-right">
              {z.polygon.length} точок
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

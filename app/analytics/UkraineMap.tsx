'use client'

import { useMemo, useState } from 'react'
import { MAP_VIEWBOX, OBLAST_SHAPES } from '@/lib/ua-oblasts'
import type { RegionStat } from '@/lib/analytics'
import { MAP_BOUNDS } from '@/lib/ua-oblasts'
import { moneyShort as money } from '@/lib/format'

const PLATFORM_LABELS: Record<string, string> = { maudau: 'MauDau', rozetka: 'Rozetka' }



/** Same projection the path generator used, so pins land on the right spot. */
function project(lat: number, lon: number): { x: number; y: number } {
  const { minLon, maxLat, spanX, spanY, k, width, height } = MAP_BOUNDS
  return {
    x: ((lon - minLon) * k) / spanX * width,
    y: (maxLat - lat) / spanY * height,
  }
}

/** Path bounds, so a selected oblast can be zoomed into. */
function boundsOf(d: string): { x: number; y: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const m of d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)) {
    const x = parseFloat(m[1]), y = parseFloat(m[2])
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

export default function UkraineMap({ regions }: { regions: RegionStat[] }) {
  const [selected, setSelected] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)

  const byOblast = useMemo(
    () => new Map(regions.map(r => [r.oblast, r])), [regions])

  const maxOrders = useMemo(
    () => Math.max(1, ...regions.map(r => r.orders)), [regions])

  // Darkest where the most orders come from
  const fillFor = (name: string) => {
    const r = byOblast.get(name)
    if (!r || r.orders === 0) return 'rgb(39 39 42)'
    const t = Math.sqrt(r.orders / maxOrders)
    return `rgba(220, 38, 38, ${(0.15 + t * 0.75).toFixed(3)})`
  }

  const viewBox = useMemo(() => {
    if (!selected) return MAP_VIEWBOX
    const shape = OBLAST_SHAPES.find(s => s.name === selected)
    if (!shape) return MAP_VIEWBOX
    const b = boundsOf(shape.d)
    // Never zoom past 3x — a small oblast would otherwise fill the whole panel
    const minSpan = MAP_BOUNDS.width / 3
    const w = Math.max(b.w, minSpan)
    const h = Math.max(b.h, minSpan * MAP_BOUNDS.height / MAP_BOUNDS.width)
    const cx = b.x + b.w / 2
    const cy = b.y + b.h / 2
    const pad = 1.15
    return `${cx - w * pad / 2} ${cy - h * pad / 2} ${w * pad} ${h * pad}`
  }, [selected])

  const active = selected ?? hovered
  const activeStat = active ? byOblast.get(active) : null
  const selectedStat = selected ? byOblast.get(selected) : null

  const unknown = byOblast.get('Не визначено')

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-zinc-800 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-white font-semibold text-sm">Географія замовлень</h2>
          <p className="text-zinc-500 text-xs mt-0.5">
            {selected
              ? 'Клікніть ще раз, щоб повернутися до всієї України'
              : 'Наведіть на область для деталей, клікніть щоб наблизити'}
          </p>
        </div>
        {selected && (
          <button
            onClick={() => setSelected(null)}
            className="px-3 py-1.5 rounded-lg text-xs bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
          >
            ← Вся Україна
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-0">
        <div className="lg:col-span-2 p-4">
          <svg
            viewBox={viewBox}
            className="w-full h-auto transition-[view-box] duration-500"
            style={{ transition: 'all 500ms ease' }}
          >
            {OBLAST_SHAPES.map(shape => {
              const stat = byOblast.get(shape.name)
              const isActive = active === shape.name
              return (
                <path
                  key={shape.code}
                  d={shape.d}
                  fill={fillFor(shape.name)}
                  stroke={isActive ? '#fafafa' : '#52525b'}
                  strokeWidth={isActive ? 2 : 0.8}
                  className="cursor-pointer transition-colors"
                  onMouseEnter={() => setHovered(shape.name)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => setSelected(s => s === shape.name ? null : shape.name)}
                >
                  <title>
                    {shape.name}
                    {stat ? ` — ${stat.orders} замовлень` : ' — немає замовлень'}
                  </title>
                </path>
              )
            })}

            {/* Pins for the pinned oblast, sized by order volume */}
            {selectedStat?.cities.map(c => {
              if (c.lat == null || c.lon == null) return null
              const { x, y } = project(c.lat, c.lon)
              const maxCity = Math.max(1, ...selectedStat.cities.map(x2 => x2.orders))
              const r = 2.5 + (c.orders / maxCity) * 4
              return (
                <g key={c.city} className="pointer-events-none">
                  <circle cx={x} cy={y} r={r + 2.5} fill="rgba(250,250,250,0.25)" />
                  <circle cx={x} cy={y} r={r} fill="#fafafa" />
                  <text
                    x={x} y={y - r - 3}
                    textAnchor="middle"
                    fill="#fafafa"
                    style={{ fontSize: Math.max(7, MAP_BOUNDS.width / 90), paintOrder: 'stroke' }}
                    stroke="rgba(0,0,0,0.7)"
                    strokeWidth={2}
                  >
                    {c.city}
                  </text>
                </g>
              )
            })}
          </svg>
        </div>

        {/* Details panel */}
        <div className="border-t lg:border-t-0 lg:border-l border-zinc-800 p-4 space-y-4">
          {!activeStat && (
            <div className="text-zinc-600 text-sm py-8 text-center">
              Наведіть на область
            </div>
          )}

          {activeStat && (
            <>
              <div>
                <div className="text-white font-semibold">{activeStat.oblast}</div>
                <div className="text-zinc-500 text-xs mt-0.5">
                  {activeStat.orders} замовлень · {money(activeStat.revenue)}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="bg-zinc-800/40 rounded-lg px-3 py-2">
                  <div className="text-emerald-400 text-lg font-bold">{activeStat.delivered}</div>
                  <div className="text-zinc-500 text-xs">доставлено</div>
                </div>
                <div className="bg-zinc-800/40 rounded-lg px-3 py-2">
                  <div className="text-red-400 text-lg font-bold">{activeStat.canceled}</div>
                  <div className="text-zinc-500 text-xs">скасовано</div>
                </div>
                <div className="bg-zinc-800/40 rounded-lg px-3 py-2">
                  <div className="text-cyan-400 text-lg font-bold">{activeStat.inFlight}</div>
                  <div className="text-zinc-500 text-xs">в процесі</div>
                </div>
              </div>

              <div>
                <div className="text-zinc-400 text-xs mb-1.5">Маркетплейси</div>
                <div className="space-y-1">
                  {Object.entries(activeStat.byPlatform).map(([p, n]) => (
                    <div key={p} className="flex items-center justify-between text-xs">
                      <span className={`px-2 py-0.5 rounded font-medium ${
                        p === 'maudau'
                          ? 'bg-purple-900/60 text-purple-300'
                          : 'bg-pink-900/60 text-pink-300'
                      }`}>
                        {PLATFORM_LABELS[p] ?? p}
                      </span>
                      <span className="text-zinc-300">{n}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="text-xs text-zinc-500">
                Періодичність:{' '}
                <span className="text-zinc-300">
                  {activeStat.cadenceDays != null
                    ? `кожні ~${activeStat.cadenceDays} дн.`
                    : 'повторних замовлень немає'}
                </span>
              </div>

              {/* Cities only once an oblast is pinned — that is the zoom-in view */}
              {selectedStat && selectedStat.oblast === activeStat.oblast && (
                <div>
                  <div className="text-zinc-400 text-xs mb-1.5">
                    Міста ({selectedStat.cities.length})
                  </div>
                  <div className="max-h-48 overflow-y-auto divide-y divide-zinc-800/60">
                    {selectedStat.cities.map(c => (
                      <div key={c.city} className="flex items-center justify-between py-1.5 text-xs">
                        <span className="text-zinc-300 truncate pr-2">
                          {c.lat == null && <span className="text-zinc-600" title="Немає в довіднику — без піна">◌ </span>}
                          {c.city}
                        </span>
                        <span className="text-zinc-500 whitespace-nowrap">
                          {c.orders} · {money(c.revenue)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedStat && selectedStat.oblast === activeStat.oblast
                && selectedStat.products.length > 0 && (
                <div>
                  <div className="text-zinc-400 text-xs mb-1.5">Товари</div>
                  <div className="max-h-48 overflow-y-auto divide-y divide-zinc-800/60">
                    {selectedStat.products.map(p => (
                      <div key={p.title} className="flex items-baseline justify-between gap-2 py-1.5 text-xs">
                        <span className="text-zinc-300 truncate">{p.title}</span>
                        <span className="text-zinc-500 whitespace-nowrap">
                          {Math.round(p.qty)} шт · {money(p.revenue)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {unknown && unknown.orders > 0 && (
            <div className="text-xs text-zinc-600 border-t border-zinc-800 pt-3">
              {unknown.orders} замовлень без визначеної області
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

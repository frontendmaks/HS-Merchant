'use client'
import { useEffect, useRef, useState } from 'react'
import { colorFor } from '@/lib/zone-colors'

export interface ZoneShape {
  code: string
  warehouse: string
  polygon: { lat: number; lng: number }[]
}

/**
 * Межі зон доставки — як вони намальовані, а не як вони працюють.
 *
 * Карта аналітики показує навантаження: скільки звідки замовлень. Тут
 * питання інше й простіше — де саме проходить межа і чия вона. Саме це
 * питають, коли адреса «поза зонами»: не «скільки», а «куди ж вона
 * потрапляє».
 *
 * Клік по фігурі називає зону: на межі двох складів інакше не збагнеш,
 * у котру з них ти поцілив.
 */
export default function ZonesMap({ zones }: { zones: ZoneShape[] }) {
  const box = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const [picked, setPicked] = useState<ZoneShape | null>(null)

  useEffect(() => {
    let map: import('leaflet').Map | null = null
    let cancelled = false

    void (async () => {
      const L = (await import('leaflet')).default
      if (cancelled || !box.current) return

      if (!document.getElementById('leaflet-css')) {
        const link = document.createElement('link')
        link.id = 'leaflet-css'
        link.rel = 'stylesheet'
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
        document.head.appendChild(link)
      }

      map = L.map(box.current, {
        center: [49.8397, 24.0297],
        zoom: 11,
        attributionControl: false,
        boxZoom: false,
      })
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 16 }).addTo(map)

      const bounds: [number, number][] = []

      for (const zone of zones) {
        if (zone.polygon.length < 3) continue
        const points = zone.polygon.map(p => [p.lat, p.lng] as [number, number])
        bounds.push(...points)

        const color = colorFor(zone.warehouse)
        const shape = L.polygon(points, {
          color, weight: 2, opacity: 0.9,
          fillColor: color, fillOpacity: 0.2,
          className: 'zone-shape',
        }).addTo(map)

        shape.bindTooltip(`<b>${zone.warehouse}</b><br>${zone.code}`, { sticky: true })
        shape.on('click', () => setPicked(p => (p?.code === zone.code ? null : zone)))
      }

      if (bounds.length) map.fitBounds(bounds, { padding: [20, 20] })
      setReady(true)
    })()

    return () => { cancelled = true; map?.remove() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zones.map(z => z.code).join(',')])

  return (
    <div className="space-y-2">
      <style>{'.zone-shape:focus { outline: none }'}</style>

      {/*
        * Карта живе у власному шарі.
        *
        * Leaflet роздає своїм панелям і кнопкам масштабу z-index до
        * тисячі — більше, ніж у бічного меню й будь-якого вікна. На
        * телефоні це видно одразу: відкрита шухляда лишалась під
        * картою, і пункти меню доводилось шукати в прогалинах між
        * зонами. `isolate` замикає ці тисячі всередині, а сам шар
        * лишається внизу.
        */}
      <div className="relative z-0 isolate">
        <div ref={box} className="h-[26rem] lg:h-[32rem] rounded-lg overflow-hidden bg-zinc-800" />
        {!ready && (
          <div className="absolute inset-0 grid place-items-center text-zinc-500 text-sm">
            Малюємо карту…
          </div>
        )}
      </div>

      {picked && (
        <div className="text-xs text-zinc-400">
          <span className="text-white">{picked.warehouse}</span>
          {' — '}{picked.code}, {picked.polygon.length} точок межі
        </div>
      )}
    </div>
  )
}

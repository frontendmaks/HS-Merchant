'use client'
import { useEffect, useRef, useState } from 'react'
import { colorFor } from '@/lib/zone-colors'

export interface ZoneLoad {
  code: string
  warehouse: string
  polygon: { lat: number; lng: number }[]
  orders: number
  revenue: number
}

/**
 * Географія доставок — зонами, не областями.
 *
 * Усі ці замовлення львівські, тож карта України відповідала б однією
 * плямою. Питання стоїть інакше: котра частина міста й околиць дає роботу
 * котрому складу.
 *
 * Фарбуємо за складом, а не за зоною: зон вісім, а складів сім — АС 2
 * обслуговує дві окремі плями, і на карті вони мають читатись як один склад.
 */
export default function DeliveryMap({ zones }: { zones: ZoneLoad[] }) {
  const box = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)

  // Склади, а не зони: дві плями одного складу — один рядок у легенді
  const byWarehouse = new Map<string, { orders: number; revenue: number; zones: number }>()
  for (const z of zones) {
    const acc = byWarehouse.get(z.warehouse) ?? { orders: 0, revenue: 0, zones: 0 }
    acc.orders += z.orders
    acc.revenue += z.revenue
    acc.zones++
    byWarehouse.set(z.warehouse, acc)
  }
  const legend = [...byWarehouse].sort((a, b) => b[1].orders - a[1].orders)

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
        // Рамка виділення при перетягуванні — не наш випадок: тут клікають
        // по зонах, а не вибирають прямокутники
        boxZoom: false,
      })
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 16 }).addTo(map)

      const bounds: [number, number][] = []

      for (const zone of zones) {
        if (zone.polygon.length < 3) continue
        const points = zone.polygon.map(p => [p.lat, p.lng] as [number, number])
        bounds.push(...points)

        const color = colorFor(zone.warehouse)
        const load = byWarehouse.get(zone.warehouse)

        const shape = L.polygon(points, {
          color,
          weight: 2,
          opacity: 0.9,
          fillColor: color,
          fillOpacity: 0.25,
          className: 'zone-shape',
        }).addTo(map)

        shape.bindTooltip(
          `<b>${zone.warehouse}</b><br>${load?.orders ?? 0} замовлень<br>` +
          `${Math.round(load?.revenue ?? 0).toLocaleString('uk-UA')} ₴`,
          { sticky: true },
        )

        shape.on('click', () => setPicked(p => (p === zone.warehouse ? null : zone.warehouse)))
      }

      if (bounds.length) map.fitBounds(bounds, { padding: [20, 20] })
      setReady(true)
    })()

    return () => { cancelled = true; map?.remove() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zones.length])

  const chosen = picked ? byWarehouse.get(picked) : null

  return (
    <div className="space-y-2">
      {/* Обведення після кліку — браузерне й тут зайве */}
      <style>{'.zone-shape:focus { outline: none }'}</style>

      <div className="relative">
        <div ref={box} className="h-[32rem] rounded-lg overflow-hidden bg-zinc-800" />
        {!ready && (
          <div className="absolute inset-0 grid place-items-center text-zinc-500 text-sm">
            Малюємо карту…
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {legend.map(([warehouse, load]) => (
          <button
            key={warehouse}
            onClick={() => setPicked(p => (p === warehouse ? null : warehouse))}
            className={`flex items-center gap-1.5 text-xs transition-opacity ${
              picked && picked !== warehouse ? 'opacity-40' : ''
            }`}
          >
            <span className="w-3 h-3 rounded-sm shrink-0"
              style={{ background: colorFor(warehouse) }} />
            <span className="text-zinc-300">{warehouse}</span>
            <span className="text-zinc-500 tabular-nums">{load.orders}</span>
          </button>
        ))}
      </div>

      {chosen && picked && (
        <div className="text-xs text-zinc-400">
          <span className="text-white">{picked}</span>
          {' — '}{chosen.orders} замовлень на{' '}
          {Math.round(chosen.revenue).toLocaleString('uk-UA')} ₴
          {chosen.zones > 1 && ` · ${chosen.zones} зони`}
        </div>
      )}
    </div>
  )
}

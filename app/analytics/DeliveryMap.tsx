'use client'
import { useEffect, useRef, useState } from 'react'

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
 * котрому складу. Малюємо ті самі полігони, за якими возимо, і фарбуємо їх
 * за кількістю замовлень — видно і розподіл, і перекоси.
 */
export default function DeliveryMap({ zones }: { zones: ZoneLoad[] }) {
  const box = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)

  const max = Math.max(1, ...zones.map(z => z.orders))

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

      map = L.map(box.current, { center: [49.8397, 24.0297], zoom: 10, attributionControl: false })
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 16 }).addTo(map)

      const bounds: [number, number][] = []

      for (const zone of zones) {
        if (zone.polygon.length < 3) continue
        const points = zone.polygon.map(p => [p.lat, p.lng] as [number, number])
        bounds.push(...points)

        // Насиченість — частка від найзавантаженішої зони: порожні зони
        // лишаються видимими, але не відтягують увагу
        const share = zone.orders / max
        L.polygon(points, {
          color: '#dc2626',
          weight: 1.5,
          opacity: 0.8,
          fillColor: '#dc2626',
          fillOpacity: 0.08 + share * 0.45,
        }).addTo(map).bindTooltip(
          `<b>${zone.warehouse}</b><br>${zone.orders} замовлень<br>` +
          `${Math.round(zone.revenue).toLocaleString('uk-UA')} ₴`,
          { sticky: true },
        )
      }

      if (bounds.length) map.fitBounds(bounds, { padding: [16, 16] })
      setReady(true)
    })()

    return () => { cancelled = true; map?.remove() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zones.length, max])

  return (
    <div className="relative">
      <div ref={box} className="h-96 rounded-lg overflow-hidden bg-zinc-800" />
      {!ready && (
        <div className="absolute inset-0 grid place-items-center text-zinc-500 text-sm">
          Малюємо карту…
        </div>
      )}
    </div>
  )
}

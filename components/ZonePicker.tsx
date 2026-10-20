'use client'
import { useEffect, useRef, useState } from 'react'

export interface ZoneShape {
  code: string
  warehouse: string
  polygon: { lat: number; lng: number }[]
}

/**
 * Карта зон доставки з піном на адресі.
 *
 * Потрібна рівно тоді, коли довідник адрес здався: оператор бачить вулицю на
 * мапі краще, ніж геокодер у рядку. Зони намальовані тими самими полігонами,
 * що на сайті, тож вибір складу перестає бути вгадуванням — видно, в яку
 * саме зону потрапив пін.
 */
export default function ZonePicker({ point, zones, warehouse, onPick }: {
  point: { lat: number; lng: number } | null
  zones: ZoneShape[]
  warehouse: string
  onPick: (warehouse: string, zone: string) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let map: import('leaflet').Map | null = null
    let cancelled = false

    void (async () => {
      const L = (await import('leaflet')).default
      if (cancelled || !box.current) return

      // Стилі вантажимо разом із бібліотекою: без них карта — набір плиток
      // один під одним
      if (!document.getElementById('leaflet-css')) {
        const link = document.createElement('link')
        link.id = 'leaflet-css'
        link.rel = 'stylesheet'
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
        document.head.appendChild(link)
      }

      // Центр — сам Львів, поки адреси немає
      const center: [number, number] = point ? [point.lat, point.lng] : [49.8397, 24.0297]
      map = L.map(box.current, { center, zoom: point ? 14 : 11, attributionControl: false })

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
      }).addTo(map)

      for (const zone of zones) {
        if (zone.polygon.length < 3) continue
        const shape = L.polygon(
          zone.polygon.map(p => [p.lat, p.lng] as [number, number]),
          {
            color: zone.warehouse === warehouse ? '#dc2626' : '#16a34a',
            weight: zone.warehouse === warehouse ? 3 : 1.5,
            fillOpacity: zone.warehouse === warehouse ? 0.18 : 0.06,
          },
        ).addTo(map)

        shape.bindTooltip(zone.warehouse, { sticky: true })
        // Клік по зоні — вибір складу: саме так це й читається з карти
        shape.on('click', () => onPick(zone.warehouse, zone.code))
      }

      if (point) {
        L.circleMarker([point.lat, point.lng], {
          radius: 7, color: '#fff', weight: 2, fillColor: '#dc2626', fillOpacity: 1,
        }).addTo(map).bindTooltip('Адреса', { permanent: false })
      }

      setReady(true)
    })()

    return () => { cancelled = true; map?.remove() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [point?.lat, point?.lng, zones.length, warehouse])

  return (
    <div className="relative">
      <div ref={box} className="h-72 rounded-lg overflow-hidden bg-zinc-800" />
      {!ready && (
        <div className="absolute inset-0 grid place-items-center text-zinc-500 text-xs">
          Малюємо карту…
        </div>
      )}
      <div className="text-zinc-500 text-xs mt-1">
        {point
          ? 'Пін — знайдена адреса. Натисніть зону, щоб обрати її склад'
          : 'Адресу не знайдено — оберіть зону, у якій вона лежить'}
      </div>
    </div>
  )
}

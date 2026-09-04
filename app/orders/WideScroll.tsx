'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * A horizontal scrollbar for a wide table that stays reachable.
 *
 * The table's own scrollbar sits at its bottom edge, which on a long list is
 * far below the fold — with a mouse and no trackpad there is then no way to
 * move sideways without first scrolling to the very end of the page.
 *
 * So this pins a second bar to the bottom of the window whenever the real one
 * is out of view. It is drawn rather than borrowed: overlay scrollbars, which
 * every current browser uses by default, take up no height and fade out when
 * idle, so a native bar here would be exactly as invisible as the problem it
 * is meant to solve.
 */
export default function WideScroll({ children }: { children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)

  const [geo, setGeo] = useState<
    { left: number; width: number; content: number; visible: number; at: number } | null
  >(null)

  const measure = useCallback(() => {
    const el = box.current
    if (!el) return setGeo(null)

    const rect = el.getBoundingClientRect()
    const overflows = el.scrollWidth > el.clientWidth + 1
    // Its own bar is already on screen, or the table is not on screen at all
    const ownBarVisible = rect.bottom <= window.innerHeight
    const offScreen = rect.bottom < 0 || rect.top > window.innerHeight
    if (!overflows || ownBarVisible || offScreen) return setGeo(null)

    setGeo({
      left: rect.left, width: rect.width,
      content: el.scrollWidth, visible: el.clientWidth, at: el.scrollLeft,
    })
  }, [])

  useEffect(() => {
    measure()
    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => { frame = 0; measure() })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', measure)
    // Rows change height as orders load and as notes are typed into them
    const ro = box.current ? new ResizeObserver(measure) : null
    if (box.current && ro) ro.observe(box.current)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', measure)
      ro?.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [measure])

  const maxScroll = geo ? geo.content - geo.visible : 0
  // A thumb narrower than this is too small to aim at, however wide the table
  const thumbWidth = geo
    ? Math.max(44, (geo.visible / geo.content) * geo.width)
    : 0
  const thumbLeft = geo && maxScroll > 0
    ? (geo.at / maxScroll) * (geo.width - thumbWidth)
    : 0

  /** Track pixels the thumb can travel, mapped onto the scroll range. */
  const scrollTo = (thumbX: number) => {
    if (!box.current || !geo || maxScroll <= 0) return
    const travel = geo.width - thumbWidth
    const ratio = travel > 0 ? Math.min(1, Math.max(0, thumbX / travel)) : 0
    box.current.scrollLeft = ratio * maxScroll
    measure()
  }

  const drag = (e: React.PointerEvent) => {
    if (!geo) return
    e.preventDefault()
    const startX = e.clientX
    const startLeft = thumbLeft
    const move = (ev: PointerEvent) => scrollTo(startLeft + (ev.clientX - startX))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // Clicking the empty track jumps there, with the thumb centred on the click
  const jump = (e: React.PointerEvent) => {
    if (!track.current) return
    const x = e.clientX - track.current.getBoundingClientRect().left
    scrollTo(x - thumbWidth / 2)
  }

  return (
    <>
      <div ref={box} onScroll={measure} className="overflow-x-auto wide-scroll">
        {children}
      </div>

      {geo && (
        <div
          className="fixed bottom-0 z-40 h-4 bg-zinc-950/90 backdrop-blur border-t border-zinc-800"
          style={{ left: geo.left, width: geo.width }}
        >
          <div
            ref={track}
            onPointerDown={jump}
            className="relative h-full cursor-pointer"
            role="scrollbar"
            aria-label="Горизонтальна прокрутка таблиці"
            aria-controls="orders-table"
          >
            <div
              onPointerDown={e => { e.stopPropagation(); drag(e) }}
              className="absolute top-1 h-2 rounded-full bg-zinc-600 hover:bg-zinc-400
                         transition-colors cursor-grab active:cursor-grabbing"
              style={{ left: thumbLeft, width: thumbWidth }}
            />
          </div>
        </div>
      )}
    </>
  )
}

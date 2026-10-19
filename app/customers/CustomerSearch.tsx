'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

/** Пошук із паузою: сторінка перемальовується, коли людина дописала. */
export default function CustomerSearch({ initial, sort }: { initial: string; sort: string }) {
  const router = useRouter()
  const [value, setValue] = useState(initial)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const first = useRef(true)

  useEffect(() => {
    if (first.current) { first.current = false; return }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const params = new URLSearchParams()
      if (value.trim()) params.set('q', value.trim())
      params.set('sort', sort)
      router.push(`/customers?${params}`)
    }, 350)
  }, [value, sort, router])

  return (
    <input
      value={value}
      onChange={e => setValue(e.target.value)}
      placeholder="Телефон або ім'я"
      className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm
                 placeholder-zinc-600 focus:outline-none focus:border-red-500 w-64"
    />
  )
}

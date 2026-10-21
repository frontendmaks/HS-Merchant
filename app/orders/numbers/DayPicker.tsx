'use client'
import { useRouter } from 'next/navigation'

export default function DayPicker({ date, today }: { date: string; today: string }) {
  const router = useRouter()
  const go = (d: string) => router.push(`/orders/numbers?date=${d}`)

  const shift = (days: number) => {
    const d = new Date(`${date}T12:00:00`)
    d.setDate(d.getDate() + days)
    go(d.toISOString().slice(0, 10))
  }

  return (
    <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1">
      <button onClick={() => shift(-1)}
        className="px-2 py-1 text-zinc-400 hover:text-white text-sm transition-colors">‹</button>
      <input
        type="date" value={date} onChange={e => go(e.target.value)}
        className="bg-transparent text-white text-xs px-1 focus:outline-none"
      />
      <button onClick={() => shift(1)}
        className="px-2 py-1 text-zinc-400 hover:text-white text-sm transition-colors">›</button>
      {date !== today && (
        <button onClick={() => go(today)}
          className="px-2 py-1 text-zinc-400 hover:text-white text-xs transition-colors">
          сьогодні
        </button>
      )}
    </div>
  )
}

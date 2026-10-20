'use client'

export interface AreaStat {
  area: string
  orders: number
  revenue: number
}

/**
 * Куди возимо — районами Львова й селами.
 *
 * Карта областей тут не відповідає ні на що: усі замовлення з сайту й
 * телефону львівські, і вся Україна світилась би однією плямою. Значення має
 * інше — котрий район міста й котрі села дають роботу, бо між ними
 * розподіляються склади.
 */
export default function AreaBreakdown({ areas }: { areas: AreaStat[] }) {
  if (!areas.length) {
    return (
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 text-center
                      text-zinc-500 text-sm">
        Районів ще не визначено — вони з'являються, щойно адреси розпізнаються
      </div>
    )
  }

  const max = Math.max(...areas.map(a => a.orders))
  const city = areas.filter(a => a.area.endsWith('район'))
  const outside = areas.filter(a => !a.area.endsWith('район'))

  const row = (a: AreaStat) => (
    <div key={a.area} className="flex items-center gap-3">
      <span className="text-zinc-300 text-xs w-44 shrink-0 truncate">{a.area}</span>
      <div className="flex-1 h-5 bg-zinc-800/60 rounded overflow-hidden">
        <div
          className="h-full bg-red-600/70"
          style={{ width: `${Math.max(2, (a.orders / max) * 100)}%` }}
        />
      </div>
      <span className="text-white text-xs w-10 text-right tabular-nums">{a.orders}</span>
      <span className="text-zinc-500 text-xs w-24 text-right tabular-nums">
        {Math.round(a.revenue).toLocaleString('uk-UA')} ₴
      </span>
    </div>
  )

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 space-y-4">
      <div>
        <h3 className="text-white text-sm font-semibold">Куди возимо</h3>
        <p className="text-zinc-500 text-xs mt-0.5">
          Райони Львова й населені пункти навколо — за кількістю замовлень
        </p>
      </div>

      {city.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-zinc-400 text-xs">Львів</div>
          {city.map(row)}
        </div>
      )}

      {outside.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-zinc-400 text-xs">Околиці</div>
          {outside.slice(0, 15).map(row)}
        </div>
      )}
    </div>
  )
}

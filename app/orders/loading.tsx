/**
 * Поки сервер збирає сторінку.
 *
 * Перехід між місяцями — це запит до бази, і без цього екрана він виглядав як
 * зависання: натиснув і сидиш перед старою таблицею, не розуміючи, чи щось
 * відбувається. Каркас показує, що відбувається, і де саме з'явиться вміст.
 */
export default function Loading() {
  return (
    <div className="bg-zinc-950 text-white space-y-4 animate-pulse">
      <div className="h-7 w-48 bg-zinc-900 rounded" />
      <div className="flex gap-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-8 w-28 bg-zinc-900 rounded" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-20 bg-zinc-900 rounded-xl border border-zinc-800" />
        ))}
      </div>
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 divide-y divide-zinc-800">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="h-12" />
        ))}
      </div>
    </div>
  )
}

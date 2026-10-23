'use client'
import { useState } from 'react'

const STARS = [1, 2, 3, 4, 5]

export default function ReviewForm({ token, rating: saved, comment: savedComment }: {
  token: string
  rating?: number
  comment: string
}) {
  const [rating, setRating] = useState(saved ?? 0)
  const [hover, setHover] = useState(0)
  const [comment, setComment] = useState(savedComment)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(!!saved)
  const [error, setError] = useState<string | null>(null)

  async function send() {
    if (!rating) { setError('Оберіть оцінку'); return }
    setBusy(true)
    setError(null)
    try {
      const r = await fetch('/api/vidhuk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, rating, comment }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? 'Не вдалося надіслати')
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="mt-6 bg-zinc-900 border border-zinc-800 rounded-xl p-5 text-center">
        <div className="text-3xl">{'★'.repeat(rating)}</div>
        <p className="text-zinc-300 text-sm mt-3">
          Дякуємо! Ваш відгук збережено.
        </p>
        {/* Змінити оцінку можна: перше враження іноді міняється, поки
            людина розкладає покупки */}
        <button
          onClick={() => setDone(false)}
          className="mt-3 text-zinc-500 hover:text-white text-xs transition-colors"
        >
          Змінити
        </button>
      </div>
    )
  }

  return (
    <div className="mt-6 bg-zinc-900 border border-zinc-800 rounded-xl p-5">
      <div className="flex justify-center gap-1.5">
        {STARS.map(n => (
          <button
            key={n}
            onClick={() => setRating(n)}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            aria-label={`${n} з 5`}
            /* Зірка — найменша ціль на цій сторінці й головна: у неї
               цілять пальцем з телефона, часто на ходу. Тому сама зірка
               лишається тією ж, а натискати можна по всьому квадрату */
            className={`text-4xl leading-none transition-colors
                        w-12 h-12 flex items-center justify-center ${
              n <= (hover || rating) ? 'text-amber-400' : 'text-zinc-700'
            }`}
          >
            {'★'}
          </button>
        ))}
      </div>

      <textarea
        value={comment}
        onChange={e => setComment(e.target.value)}
        rows={4}
        placeholder="Що сподобалось, а що варто виправити? (не обов'язково)"
        className="w-full mt-4 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2
                   text-white text-sm focus:outline-none focus:border-red-500"
      />

      <button
        onClick={() => void send()}
        disabled={busy}
        className="w-full mt-3 bg-red-600 hover:bg-red-500 disabled:opacity-50
                   text-white text-sm font-medium h-11 rounded-lg transition-colors"
      >
        {busy ? 'Надсилаю…' : 'Надіслати відгук'}
      </button>

      {error && <p className="mt-2 text-amber-400 text-xs text-center">{error}</p>}
    </div>
  )
}

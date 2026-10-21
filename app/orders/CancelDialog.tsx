'use client'
import { useEffect, useState } from 'react'
import { SITE_CANCEL_REASONS } from '@/lib/cancel-reasons'

/**
 * Скасування й видалення — вікном посеред екрана.
 *
 * Спершу вибір причини стояв під рядком таблиці. Технічно він працював,
 * але знайти його було неможливо: рядок вузький, таблиця широка, і
 * панель губилась за правим краєм. Там, де людині треба щось вирішити,
 * вікно має заступити все інше — інакше вона й далі впиратиметься в
 * відмову «спочатку оберіть причину».
 */
export default function CancelDialog({ title, note, confirmLabel, busy, error, onCancel, onConfirm }: {
  title: string
  note?: string
  confirmLabel: string
  busy?: boolean
  error?: string | null
  onCancel: () => void
  /** Причина порожня для видалення — там її не питають */
  onConfirm: (reason: string, comment: string) => void
}) {
  const [reason, setReason] = useState('')
  const [comment, setComment] = useState('')

  // Escape закриває: вікно перекриває роботу, і вийти з нього має бути
  // так само легко, як відкрити
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const needsReason = confirmLabel !== 'Видалити'

  /*
   * Без порталу: `position: fixed` і так рахується від вікна, а
   * портал вимагав би чекати на монтування й тримати для цього стан.
   * Прокрутка таблиці навколо на fixed не впливає.
   */
  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center p-4 pt-24"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm bg-zinc-900 border border-zinc-700 rounded-xl p-4 space-y-3"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-white text-sm font-semibold">{title}</h2>
        {note && <p className="text-zinc-400 text-xs">{note}</p>}

        {needsReason && (
          <>
            <select
              value={reason}
              onChange={e => setReason(e.target.value)}
              autoFocus
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-2
                         text-sm text-white focus:outline-none focus:border-red-500"
            >
              <option value="">Оберіть причину…</option>
              {SITE_CANCEL_REASONS.map(group => (
                <optgroup key={group.group} label={group.group}>
                  {group.items.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>

            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              rows={3}
              placeholder="Коментар — що саме сталося (не обов'язково)"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-2
                         text-sm text-white resize-none focus:outline-none focus:border-red-500"
            />
          </>
        )}

        {error && (
          <div className="bg-amber-950/40 border border-amber-900 rounded-lg px-2.5 py-1.5
                          text-amber-400 text-xs">
            {error}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            onClick={() => onConfirm(reason, comment)}
            disabled={busy || (needsReason && !reason)}
            className="bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white
                       text-sm px-3 py-1.5 rounded-lg transition-colors"
          >
            {busy ? 'Виконую…' : confirmLabel}
          </button>
          <button
            onClick={onCancel}
            className="text-zinc-400 hover:text-white text-sm px-3 py-1.5 transition-colors"
          >
            Відмінити
          </button>
        </div>
      </div>
    </div>
  )
}

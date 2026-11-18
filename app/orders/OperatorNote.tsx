'use client'

import { useState } from 'react'

/**
 * Нотатка оператора до замовлення — та сама, що в рядках маркетплейсів.
 *
 * Окремим компонентом, бо замовлення з сайту живуть у серверній таблиці,
 * а поле має зберігатись саме, щойно з нього пішли. Пише в той самий
 * `operator_comment`, тож журнал, інтеграції й пошук бачать її однаково,
 * звідки б замовлення не прийшло.
 */
export default function OperatorNote({
  orderId,
  initial,
  readOnly = false,
}: {
  orderId: string
  initial: string | null
  readOnly?: boolean
}) {
  const [note, setNote] = useState(initial ?? '')
  const [draft, setDraft] = useState(initial ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Сторінка оновлюється з сервера, коли нотатку змінив хтось інший:
  // нове значення ззовні замінює і збережене, і чернетку
  const [seen, setSeen] = useState(initial)
  if (initial !== seen) {
    setSeen(initial)
    setNote(initial ?? '')
    setDraft(initial ?? '')
  }

  async function save() {
    if (draft.trim() === note.trim()) return
    setError('')
    setSaving(true)
    try {
      const res = await fetch(`/api/orders/${orderId}/comment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: draft }),
      })
      const data = (await res.json()) as { success: boolean; comment?: string | null; error?: string }
      if (!data.success) throw new Error(data.error || 'Помилка збереження нотатки')
      const saved = data.comment ?? ''
      setNote(saved)
      setDraft(saved)
    } catch (e) {
      // Набране лишаємо: втратити чуже речення гірше, ніж показати його незбереженим
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  if (readOnly) {
    return <span className="text-zinc-400 text-xs whitespace-pre-wrap break-words">{note || '—'}</span>
  }

  return (
    <>
      <textarea
        value={draft}
        rows={2}
        disabled={saving}
        onChange={e => setDraft(e.target.value)}
        onBlur={save}
        placeholder="Нотатка…"
        className="bg-zinc-800 text-white border border-zinc-700 rounded px-1.5 py-1 text-xs w-full resize-y disabled:opacity-50 placeholder:text-zinc-600"
      />
      {saving && <div className="text-zinc-500 text-xs mt-0.5">Збереження...</div>}
      {error && <div className="text-red-400 text-xs mt-0.5">{error}</div>}
    </>
  )
}

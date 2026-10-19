'use client'
import { useEffect, useState } from 'react'

interface Chat { id: string; title: string }
interface Linked { warehouse: string; dialog_id: string; title: string | null }

/**
 * Куди надсилати бланк кожного складу.
 *
 * Налаштування разове, тож живе тут, поруч із прийомом замовлень, а не в
 * окремому розділі, куди ніхто не зайде. Чати бот бачить лише після того, як
 * його додали в групу — доти список порожній, і це не помилка.
 */
export default function TelegramChats() {
  const [data, setData] = useState<{
    warehouses: string[]; linked: Linked[]; chats: Chat[]; error: string | null
  } | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState('')

  async function load() {
    const r = await fetch('/api/chats')
    if (r.ok) setData(await r.json())
  }
  useEffect(() => { if (open) void load() }, [open])

  async function link(warehouse: string, dialogId: string) {
    setBusy(warehouse)
    const chat = data?.chats.find(c => c.id === dialogId)
    await fetch('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        warehouse,
        dialog_id: dialogId || null,
        title: chat?.title ?? null,
      }),
    })
    await load()
    setBusy('')
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-zinc-500 hover:text-zinc-300 text-xs transition-colors"
      >
        Чати складів →
      </button>
    )
  }

  const linkedBy = new Map((data?.linked ?? []).map(l => [l.warehouse, l]))

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-white text-sm font-medium">Чати складів</div>
          <div className="text-zinc-500 text-xs mt-0.5">
            Бланк нового замовлення йде в чат Бітрікса того складу, на який воно впало
          </div>
        </div>
        <button onClick={() => setOpen(false)} className="text-zinc-500 hover:text-white text-sm">
          згорнути
        </button>
      </div>

      {data?.error && (
        <div className="bg-amber-950/40 border border-amber-900 rounded-lg px-3 py-2
                        text-amber-400 text-xs">
          {data.error}
        </div>
      )}

      {data && data.chats.length === 0 && !data.error && (
        <div className="text-zinc-500 text-xs">
          Чатів не видно — перевірте, чи має доступ до них той користувач
          Бітрікса, від чийого імені працює інтеграція.
        </div>
      )}

      <div className="space-y-1.5">
        {(data?.warehouses ?? []).map(w => {
          const current = linkedBy.get(w)
          return (
            <div key={w} className="flex items-center gap-2">
              <span className="text-zinc-300 text-xs w-56 shrink-0 truncate">{w}</span>
              <select
                value={current?.dialog_id ?? ''}
                disabled={busy === w}
                onChange={e => void link(w, e.target.value)}
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1
                           text-white text-xs focus:outline-none focus:border-red-500"
              >
                <option value="">— не надсилати —</option>
                {current && !(data?.chats ?? []).some(c => c.id === current.dialog_id) && (
                  <option value={current.dialog_id}>
                    {current.title ?? current.dialog_id}
                  </option>
                )}
                {(data?.chats ?? []).map(c => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
            </div>
          )
        })}
      </div>
    </div>
  )
}

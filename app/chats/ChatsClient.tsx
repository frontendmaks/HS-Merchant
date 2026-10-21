'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CHANNEL_LABEL, type Thread, type Message, type Channel } from '@/lib/chats'

const CHANNEL_TONE: Record<string, string> = {
  telegram: 'bg-sky-950 text-sky-400',
  rozetka: 'bg-emerald-950 text-emerald-400',
  prom: 'bg-violet-950 text-violet-400',
  viber: 'bg-purple-950 text-purple-400',
}

const when = (iso: string | null) => iso
  ? new Date(iso).toLocaleString('uk-UA', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    })
  : ''

export default function ChatsClient({ threads, picked, messages }: {
  threads: Thread[]
  picked: string | null
  messages: Message[]
}) {
  const router = useRouter()
  const [, start] = useTransition()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottom = useRef<HTMLDivElement>(null)

  // Нове повідомлення має бути видно без прокрутки — інакше оператор
  // відповідає на передостаннє
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }) }, [messages.length, picked])

  // Поки сторінка відкрита, нові повідомлення самі підтягуються
  useEffect(() => {
    const timer = setInterval(() => start(() => router.refresh()), 15_000)
    return () => clearInterval(timer)
  }, [router])

  const open = threads.find(t => t.id === picked) ?? null

  async function send() {
    const body = text.trim()
    if (!body || !picked) return
    setBusy(true)
    setError(null)
    try {
      const r = await fetch(`/api/chats/${picked}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: body }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? 'Не вдалося надіслати')
      setText('')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!threads.length) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-10 text-center">
        <p className="text-zinc-400 text-sm">Повідомлень поки немає</p>
        <p className="text-zinc-600 text-xs mt-1">
          Щойно покупець напише в Telegram, розмова з&apos;явиться тут
        </p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 items-start">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden
                      max-h-[70vh] overflow-y-auto">
        {threads.map(t => (
          <button
            key={t.id}
            onClick={() => start(() => router.push(`/chats?id=${t.id}`))}
            className={`w-full text-left px-3 py-2.5 border-b border-zinc-800/60
                        transition-colors ${
              t.id === picked ? 'bg-zinc-800' : 'hover:bg-zinc-800/50'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                CHANNEL_TONE[t.channel] ?? 'bg-zinc-800 text-zinc-400'
              }`}>
                {CHANNEL_LABEL[t.channel as Channel] ?? t.channel}
              </span>
              <span className="text-white text-sm truncate flex-1">
                {t.customer_name ?? t.customer_phone ?? 'Без імені'}
              </span>
              {t.unread > 0 && (
                <span className="bg-red-600 text-white text-[10px] px-1.5 py-0.5 rounded-full">
                  {t.unread}
                </span>
              )}
            </div>
            <div className="text-zinc-500 text-xs mt-1 truncate">{t.last_message}</div>
            <div className="text-zinc-600 text-[11px] mt-0.5">{when(t.last_message_at)}</div>
          </button>
        ))}
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl flex flex-col
                      max-h-[70vh]">
        {open && (
          <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2">
            <span className="text-white text-sm font-semibold">
              {open.customer_name ?? 'Без імені'}
            </span>
            {open.customer_phone && (
              <span className="text-zinc-500 text-xs">{open.customer_phone}</span>
            )}
            <span className="ml-auto text-zinc-600 text-xs">
              {CHANNEL_LABEL[open.channel as Channel] ?? open.channel}
            </span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {messages.map(m => (
            <div key={m.id} className={m.direction === 'out' ? 'text-right' : ''}>
              <div className={`inline-block max-w-[80%] text-left rounded-lg px-3 py-2 text-sm ${
                m.direction === 'out'
                  ? 'bg-red-950/60 text-zinc-100'
                  : 'bg-zinc-800 text-zinc-200'
              }`}>
                <div className="whitespace-pre-wrap break-words">{m.body}</div>
                <div className="text-[11px] text-zinc-500 mt-1">
                  {when(m.sent_at)}
                  {m.author_name ? ` · ${m.author_name}` : ''}
                  {m.error ? ` · не надіслано: ${m.error}` : ''}
                </div>
              </div>
            </div>
          ))}
          <div ref={bottom} />
        </div>

        <div className="border-t border-zinc-800 p-3">
          <div className="flex gap-2">
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => {
                // Enter надсилає, Shift+Enter переносить рядок: відповідають
                // тут короткими фразами, і тягтись до кнопки щоразу незручно
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() }
              }}
              rows={2}
              placeholder="Відповідь клієнту…"
              className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2
                         text-white text-sm resize-none focus:outline-none focus:border-red-500"
            />
            <button
              onClick={() => void send()}
              disabled={busy || !text.trim()}
              className="bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white
                         text-sm px-4 rounded-lg transition-colors"
            >
              {busy ? '…' : 'Надіслати'}
            </button>
          </div>
          {error && <p className="text-amber-400 text-xs mt-2">{error}</p>}
        </div>
      </div>
    </div>
  )
}

'use client'
import { useState } from 'react'
import Link from 'next/link'
import { platformLabel, processingHref } from '@/lib/order-source'

export interface Customer {
  phone_key: string
  phone: string
  name: string | null
  /** ПІБ, вписане людиною — головніше за зібране із замовлень */
  name_override?: string | null
  addresses_added?: string[] | null
  addresses_hidden?: string[] | null
  phones_added?: string[] | null
  phones_hidden?: string[] | null
  phones: string[]
  names: string[] | null
  addresses: string[] | null
  platforms: string[] | null
  orders_count: number
  total_spent: number | null
  avg_check: number | null
  first_order: string | null
  last_order: string | null
  canceled: number
}

interface Order {
  id: string; external_id: string | null; manual_number: number | null
  platform: string | null; order_date: string | null; status: string | null
  total: number | null; address: string | null; warehouse: string | null
  delivery_date: string | null; delivery_slot: string | null
  review?: { rating: number; comment: string | null }[] | null
}
interface Product {
  title: string; qty: number; unit: string | null; times: number; last_order: string | null
}

const money = (n: number | null) =>
  (Number(n) || 0).toLocaleString('uk-UA', { maximumFractionDigits: 0 }) + ' ₴'

/** Скільки днів тому — «давно не замовляв» видно з першого погляду */
function ago(date: string | null) {
  if (!date) return '—'
  const days = Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000)
  if (days <= 0) return 'сьогодні'
  if (days === 1) return 'учора'
  if (days < 31) return `${days} дн. тому`
  const months = Math.floor(days / 30)
  return months < 12 ? `${months} міс. тому` : `${Math.floor(months / 12)} р. тому`
}

/** Та сама адреса приходить трьома написаннями — зводимо до одного */
const sameAddress = (a: string) => a.trim().toLowerCase().replace(/\s+/g, ' ')

/** «0677372857» і «+38 (067) 737-28-57» — один номер, не два */
const phoneDigits = (p: string) => p.replace(/\D/g, '').slice(-9)

export default function CustomerRow({ c }: { c: Customer }) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<{ orders: Order[]; products: Product[] } | null>(null)
  const [loading, setLoading] = useState(false)

  /*
   * Правки живуть тут, поруч із рядком.
   *
   * Сторінка — серверна, і перечитувати її на кожну прибрану адресу
   * означало б чекати відповідь, дивлячись на те, чого вже немає.
   */
  const [name, setName] = useState((c.name_override ?? '').trim() || c.name || '')
  const [editingName, setEditingName] = useState(false)
  const [addresses, setAddresses] = useState<string[]>(() => {
    const hidden = new Set((c.addresses_hidden ?? []).map(sameAddress))
    const out = new Map<string, string>()
    for (const a of [...(c.addresses ?? []), ...(c.addresses_added ?? [])]) {
      const value = (a ?? '').trim()
      if (value && !hidden.has(sameAddress(value))) out.set(sameAddress(value), value)
    }
    return [...out.values()]
  })
  const [draft, setDraft] = useState('')
  const [phoneDraft, setPhoneDraft] = useState('')
  const [phones, setPhones] = useState<string[]>(() => {
    const hidden = new Set((c.phones_hidden ?? []).map(phoneDigits))
    const out = new Map<string, string>()
    for (const p of [...(c.phones ?? []), ...(c.phones_added ?? [])]) {
      const value = (p ?? '').trim()
      const key = phoneDigits(value)
      if (value && key.length >= 9 && !hidden.has(key) && !out.has(key)) out.set(key, value)
    }
    return [...out.values()]
  })
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const shownName = name || c.name

  async function edit(body: Record<string, unknown>) {
    setSaving(true)
    setNote(null)
    try {
      const r = await fetch(`/api/customers/${c.phone_key}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? 'Не вдалося зберегти')
      setAddresses(d.addresses ?? [])
      if (d.phones) setPhones(d.phones)
      setName(d.name ?? '')
      // Бітрікс міг не прийняти — це не привід ховати правку, але сказати
      // треба: у CRM лишилось старе
      if (d.crm_error) setNote(`У Бітрікс не пішло: ${d.crm_error}`)
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function toggle() {
    const next = !open
    setOpen(next)
    if (!next || data) return
    setLoading(true)
    try {
      const r = await fetch(`/api/customers/${encodeURIComponent(c.phone_key)}`)
      setData(await r.json())
    } finally {
      setLoading(false)
    }
  }

  const stale = c.last_order
    && Date.now() - new Date(c.last_order).getTime() > 90 * 86_400_000

  return (
    <>
      <tr
        onClick={() => void toggle()}
        className="border-b border-zinc-800/60 hover:bg-zinc-800/30 cursor-pointer transition-colors"
      >
        <td className="px-3 py-2 text-zinc-600 w-4">{open ? '▾' : '▸'}</td>
        <td className="px-3 py-2">
          <div className="text-white">{shownName ?? '—'}</div>
          {(c.names?.length ?? 0) > 1 && (
            <div className="text-zinc-600 text-xs">
              також: {c.names!.filter(n => n !== shownName).slice(0, 2).join(', ')}
            </div>
          )}
        </td>
        <td className="px-3 py-2 text-zinc-300 whitespace-nowrap">
          {phones[0] ?? c.phone}
          {phones.length > 1 && (
            <span className="text-zinc-600 text-xs"> +{phones.length - 1}</span>
          )}
        </td>
        <td className="px-3 py-2 whitespace-nowrap">
          {(c.platforms ?? []).map(p => (
            <span key={p} className="inline-block px-2 py-0.5 rounded text-xs font-medium
                                     bg-zinc-800 text-zinc-300 mr-1">
              {platformLabel(p)}
            </span>
          ))}
        </td>
        <td className="px-3 py-2 text-right text-white tabular-nums">{c.orders_count}</td>
        <td className="px-3 py-2 text-right text-white tabular-nums whitespace-nowrap">
          {money(c.total_spent)}
        </td>
        <td className="px-3 py-2 text-right text-zinc-400 tabular-nums whitespace-nowrap">
          {money(c.avg_check)}
        </td>
        <td className={`px-3 py-2 whitespace-nowrap ${stale ? 'text-amber-500' : 'text-zinc-300'}`}>
          {ago(c.last_order)}
        </td>
        <td className="px-3 py-2 text-zinc-400 text-xs max-w-[22rem] truncate">
          {addresses[0] ?? '—'}
          {addresses.length > 1 && (
            <span className="text-zinc-600"> +{addresses.length - 1}</span>
          )}
        </td>
      </tr>

      {open && (
        <tr className="border-b border-zinc-800">
          <td />
          <td colSpan={8} className="px-3 py-3">
            {/* ПІБ правиться тут, а не в рядку: рядок читають швидко, і
                поле для введення в ньому заважало б тим, хто просто
                переглядає список */}
            <div className="flex items-center gap-2 mb-3">
              <span className="text-zinc-400 text-xs">ПІБ</span>
              {editingName ? (
                <>
                  <input
                    value={name}
                    autoFocus
                    onChange={e => setName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        void edit({ name }).then(() => setEditingName(false))
                      }
                      if (e.key === 'Escape') {
                        setName((c.name_override ?? '').trim() || c.name || '')
                        setEditingName(false)
                      }
                    }}
                    className="bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5
                               text-white text-sm min-w-[260px]
                               focus:outline-none focus:border-red-500"
                  />
                  <button
                    onClick={() => void edit({ name }).then(() => setEditingName(false))}
                    disabled={saving}
                    className="px-2.5 py-1.5 rounded-lg text-xs bg-red-600 hover:bg-red-500
                               text-white disabled:opacity-40 transition-colors"
                  >
                    Зберегти
                  </button>
                  <button
                    onClick={() => {
                      setName((c.name_override ?? '').trim() || c.name || '')
                      setEditingName(false)
                    }}
                    className="text-zinc-500 hover:text-white text-xs"
                  >
                    Скасувати
                  </button>
                </>
              ) : (
                <>
                  <span className="text-white text-sm">{shownName ?? '—'}</span>
                  <button
                    onClick={() => setEditingName(true)}
                    className="text-zinc-500 hover:text-white text-xs transition-colors"
                  >
                    Правити
                  </button>
                  {c.name_override && (
                    <span className="text-zinc-600 text-xs">вписано вручну</span>
                  )}
                </>
              )}
            </div>

            {loading && <div className="text-zinc-500 text-xs">Завантажуємо…</div>}
            {data && (
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <div className="text-zinc-400 text-xs mb-1.5">Що бере</div>
                  {data.products.length === 0 ? (
                    <div className="text-zinc-600 text-xs">Позицій не записано</div>
                  ) : (
                    <div className="space-y-0.5">
                      {data.products.map(p => (
                        <div key={p.title} className="flex gap-2 text-xs">
                          <span className="text-zinc-300 min-w-0 flex-1 truncate">{p.title}</span>
                          <span className="text-zinc-500 whitespace-nowrap">
                            {Math.round(Number(p.qty) * 100) / 100} {p.unit ?? ''}
                            {p.times > 1 && ` · ${p.times} раз.`}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <div className="text-zinc-400 text-xs mb-1.5">Замовлення</div>
                  <div className="space-y-0.5">
                    {data.orders.map(o => (
                      <div key={o.id} className="flex gap-2 text-xs items-baseline">
                        <span className="text-zinc-500 w-20 shrink-0">{o.order_date}</span>
                        <Link
                          href={processingHref(o.platform)}
                          className="text-zinc-300 hover:text-white min-w-0 flex-1 truncate"
                        >
                          {o.manual_number ? `№${o.manual_number}` : o.external_id}
                          <span className="text-zinc-600"> · {o.status}</span>
                        </Link>
                        {/* Оцінка поруч із сумою: разом вони й кажуть, чим
                            для клієнта було це замовлення */}
                        {o.review?.[0] && (
                          <span
                            className="text-amber-400 whitespace-nowrap"
                            title={o.review[0].comment ?? 'Без коментаря'}
                          >
                            {'\u2605'.repeat(o.review[0].rating)}
                            {o.review[0].comment ? ' ✍' : ''}
                          </span>
                        )}
                        <span className="text-zinc-400 tabular-nums whitespace-nowrap">
                          {money(o.total)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {(
                  <div className="lg:col-span-2">
                    <div className="text-zinc-400 text-xs mb-1.5">
                      Адреси
                      <span className="text-zinc-600"> — ті, що йдуть у Бітрікс</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {addresses.map(a => (
                        <span key={a}
                          className="px-2 py-1 rounded text-xs bg-zinc-800 text-zinc-300
                                     inline-flex items-center gap-1.5">
                          {a}
                          <button
                            onClick={() => void edit({ removeAddress: a })}
                            disabled={saving}
                            title="Прибрати адресу"
                            className="text-zinc-600 hover:text-red-400 transition-colors"
                          >
                            ✕
                          </button>
                        </span>
                      ))}
                      {addresses.length === 0 && (
                        <span className="text-zinc-600 text-xs">адрес немає</span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 mt-2">
                      <input
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        onKeyDown={e => {
                          if (e.key !== 'Enter' || !draft.trim()) return
                          void edit({ addAddress: draft }).then(() => setDraft(''))
                        }}
                        placeholder="Додати адресу — і Enter"
                        className="bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5
                                   text-white text-xs placeholder-zinc-600 min-w-[260px]
                                   focus:outline-none focus:border-red-500"
                      />
                      <button
                        onClick={() => void edit({ addAddress: draft }).then(() => setDraft(''))}
                        disabled={saving || !draft.trim()}
                        className="px-2.5 py-1.5 rounded-lg text-xs bg-zinc-800 text-zinc-300
                                   hover:text-white disabled:opacity-40 transition-colors"
                      >
                        Додати
                      </button>
                      {saving && <span className="text-zinc-500 text-xs">зберігаю…</span>}
                    </div>

                    {note && (
                      <div className="text-amber-500 text-xs mt-1.5">{note}</div>
                    )}

                    <div className="text-zinc-400 text-xs mt-3 mb-1.5">
                      Телефони
                      <span className="text-zinc-600"> — останній прибрати не можна</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {phones.map(p => (
                        <span key={p}
                          className="px-2 py-1 rounded text-xs bg-zinc-800 text-zinc-300
                                     inline-flex items-center gap-1.5">
                          {p}
                          {phones.length > 1 && (
                            <button
                              onClick={() => void edit({ removePhone: p })}
                              disabled={saving}
                              title="Прибрати номер"
                              className="text-zinc-600 hover:text-red-400 transition-colors"
                            >
                              ✕
                            </button>
                          )}
                        </span>
                      ))}
                    </div>

                    <div className="flex items-center gap-2 mt-2">
                      <input
                        value={phoneDraft}
                        onChange={e => setPhoneDraft(e.target.value)}
                        onKeyDown={e => {
                          if (e.key !== 'Enter' || !phoneDraft.trim()) return
                          void edit({ addPhone: phoneDraft }).then(() => setPhoneDraft(''))
                        }}
                        placeholder="Додати номер — і Enter"
                        className="bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5
                                   text-white text-xs placeholder-zinc-600 min-w-[200px]
                                   focus:outline-none focus:border-red-500"
                      />
                      <button
                        onClick={() => void edit({ addPhone: phoneDraft }).then(() => setPhoneDraft(''))}
                        disabled={saving || !phoneDraft.trim()}
                        className="px-2.5 py-1.5 rounded-lg text-xs bg-zinc-800 text-zinc-300
                                   hover:text-white disabled:opacity-40 transition-colors"
                      >
                        Додати
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

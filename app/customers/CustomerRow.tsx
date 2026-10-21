'use client'
import { useState } from 'react'
import Link from 'next/link'
import { platformLabel, processingHref } from '@/lib/order-source'

export interface Customer {
  phone_key: string
  phone: string
  name: string | null
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

export default function CustomerRow({ c }: { c: Customer }) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<{ orders: Order[]; products: Product[] } | null>(null)
  const [loading, setLoading] = useState(false)

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
          <div className="text-white">{c.name ?? '—'}</div>
          {(c.names?.length ?? 0) > 1 && (
            <div className="text-zinc-600 text-xs">
              також: {c.names!.filter(n => n !== c.name).slice(0, 2).join(', ')}
            </div>
          )}
        </td>
        <td className="px-3 py-2 text-zinc-300 whitespace-nowrap">
          {c.phone}
          {c.phones.length > 1 && (
            <span className="text-zinc-600 text-xs"> +{c.phones.length - 1}</span>
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
          {c.addresses?.[0] ?? '—'}
          {(c.addresses?.length ?? 0) > 1 && (
            <span className="text-zinc-600"> +{c.addresses!.length - 1}</span>
          )}
        </td>
      </tr>

      {open && (
        <tr className="border-b border-zinc-800">
          <td />
          <td colSpan={8} className="px-3 py-3">
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

                {(c.addresses?.length ?? 0) > 0 && (
                  <div className="lg:col-span-2">
                    <div className="text-zinc-400 text-xs mb-1.5">Адреси</div>
                    <div className="flex flex-wrap gap-1.5">
                      {c.addresses!.map(a => (
                        <span key={a} className="px-2 py-1 rounded text-xs bg-zinc-800 text-zinc-400">
                          {a}
                        </span>
                      ))}
                      {c.phones.map(p => (
                        <span key={p} className="px-2 py-1 rounded text-xs bg-zinc-800 text-zinc-400">
                          {p}
                        </span>
                      ))}
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

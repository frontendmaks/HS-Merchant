'use client'
import { useEffect, useState } from 'react'

interface Promo {
  id: string
  feed_id: string | null
  scope: 'all' | 'category' | 'product'
  category_name: string | null
  product_id: string | null
  mode: 'percent' | 'amount'
  value: number
  note: string | null
  product?: { name: string } | null
}

/**
 * Штучна акція.
 *
 * Піднімає стару ціну, не чіпаючи чинну: на вітрині маркетплейсу з'являється
 * перекреслене число, хоча ціна лишилась тією самою. Правило можна дати всім
 * товарам фіда, окремій категорії або одному товару — точніше правило
 * перебиває загальніше.
 */
export default function PricePromos({ feedId, categories, products }: {
  feedId: string
  categories: string[]
  products: { id: string; name: string }[]
}) {
  const [promos, setPromos] = useState<Promo[]>([])
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<'all' | 'category' | 'product'>('all')
  const [category, setCategory] = useState('')
  const [productId, setProductId] = useState('')
  const [productQuery, setProductQuery] = useState('')
  const [mode, setMode] = useState<'percent' | 'amount'>('percent')
  const [value, setValue] = useState('15')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    const r = await fetch(`/api/feeds/${feedId}/promos`)
    if (r.ok) setPromos((await r.json()).promos ?? [])
  }
  useEffect(() => { if (open) void load() }, [open])   // eslint-disable-line react-hooks/exhaustive-deps

  async function add() {
    setBusy(true)
    setError('')
    const r = await fetch(`/api/feeds/${feedId}/promos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope,
        category_name: scope === 'category' ? category : null,
        product_id: scope === 'product' ? productId : null,
        mode, value: Number(value),
      }),
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) setError(d.error || 'Не зберіглось')
    else await load()
    setBusy(false)
  }

  async function remove(id: string) {
    await fetch(`/api/feeds/${feedId}/promos?promo=${id}`, { method: 'DELETE' })
    await load()
  }

  const found = productQuery.trim().length < 2 ? [] : products
    .filter(p => p.name.toLowerCase().includes(productQuery.trim().toLowerCase()))
    .slice(0, 8)

  const label = (p: Promo) =>
    p.scope === 'all' ? 'усі товари фіда'
      : p.scope === 'category' ? `категорія «${p.category_name}»`
      : p.product?.name ?? 'товар'

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-zinc-500 hover:text-zinc-300 text-xs transition-colors"
      >
        Штучна акція →
      </button>
    )
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-white text-sm font-medium">Штучна акція</div>
          <div className="text-zinc-500 text-xs mt-0.5">
            Піднімає стару, перекреслену ціну. Чинна ціна не змінюється
          </div>
        </div>
        <button onClick={() => setOpen(false)} className="text-zinc-500 hover:text-white text-sm">
          згорнути
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select value={scope} onChange={e => setScope(e.target.value as typeof scope)}
          className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-white text-xs">
          <option value="all">усім товарам</option>
          <option value="category">категорії</option>
          <option value="product">одному товару</option>
        </select>

        {scope === 'category' && (
          <select value={category} onChange={e => setCategory(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-white text-xs max-w-[16rem]">
            <option value="">— оберіть категорію —</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}

        {scope === 'product' && (
          <div className="relative">
            <input
              value={productQuery}
              onChange={e => { setProductQuery(e.target.value); setProductId('') }}
              placeholder="Пошук товару"
              className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-white text-xs w-64"
            />
            {found.length > 0 && !productId && (
              <div className="absolute z-20 left-0 right-0 mt-1 bg-zinc-800 border border-zinc-700
                              rounded max-h-48 overflow-y-auto">
                {found.map(p => (
                  <button key={p.id}
                    onClick={() => { setProductId(p.id); setProductQuery(p.name) }}
                    className="w-full text-left px-2 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700">
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <span className="text-zinc-500 text-xs">підняти на</span>
        <input value={value} onChange={e => setValue(e.target.value.replace(/[^\d.]/g, ''))}
          className="w-16 bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5
                     text-white text-xs text-center" />
        <select value={mode} onChange={e => setMode(e.target.value as typeof mode)}
          className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-white text-xs">
          <option value="percent">%</option>
          <option value="amount">₴</option>
        </select>

        <button onClick={() => void add()} disabled={busy}
          className="bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white text-xs
                     px-3 py-1.5 rounded transition-colors">
          Додати
        </button>
        {error && <span className="text-red-400 text-xs">{error}</span>}
      </div>

      {promos.length > 0 && (
        <div className="space-y-1 pt-1">
          {promos.map(p => (
            <div key={p.id} className="flex items-center gap-2 text-xs">
              <span className="text-zinc-300 min-w-0 flex-1 truncate">{label(p)}</span>
              <span className="text-white whitespace-nowrap">
                +{Number(p.value)}{p.mode === 'percent' ? '%' : ' ₴'}
              </span>
              {!p.feed_id && <span className="text-zinc-600">спільне</span>}
              <button onClick={() => void remove(p.id)}
                className="text-zinc-600 hover:text-red-400 transition-colors">✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

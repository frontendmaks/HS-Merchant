'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface Category {
  id: string
  name: string
  source: 'site' | 'bitrix'
  multiplier: number
  is_system: boolean
  note: string | null
}

/**
 * Ціни фіда.
 *
 * Одне місце на два питання: яку ціну віддавати цьому майданчику і де
 * намалювати перекреслену стару. Обидва про ціну у вітрині, тож і стоять
 * поруч — інакше їх шукали б у різних кутках і правили наосліп.
 */
export default function FeedPricing({ feedId, categories: productCategories, products }: {
  feedId: string
  categories: string[]
  products: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<{
    categories: Category[]
    feed_category_id: string | null
    per_product: { category_id: string; count: number }[]
  } | null>(null)

  const [scope, setScope] = useState<'all' | 'category' | 'product'>('all')
  const [scopeCategory, setScopeCategory] = useState('')
  const [productQuery, setProductQuery] = useState('')
  const [productId, setProductId] = useState('')
  const [chosen, setChosen] = useState('')

  const [newName, setNewName] = useState('')
  const [newMultiplier, setNewMultiplier] = useState('1')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  async function load() {
    const r = await fetch(`/api/feeds/${feedId}/pricing`)
    if (r.ok) {
      const d = await r.json()
      setData(d)
      setChosen(d.feed_category_id ?? '')
    }
  }
  useEffect(() => { if (open) void load() }, [open])  // eslint-disable-line react-hooks/exhaustive-deps

  async function send(payload: Record<string, unknown>, ok: string) {
    setBusy(true); setError(''); setDone('')
    const r = await fetch(`/api/feeds/${feedId}/pricing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) setError(d.error || 'Не зберіглось')
    else { setDone(ok); await load(); router.refresh() }
    setBusy(false)
  }

  const found = productQuery.trim().length < 2 ? [] : products
    .filter(p => p.name.toLowerCase().includes(productQuery.trim().toLowerCase()))
    .slice(0, 8)

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="text-zinc-500 hover:text-zinc-300 text-xs transition-colors">
        Категорія ціни →
      </button>
    )
  }

  const current = data?.categories.find(c => c.id === data.feed_category_id)

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-white text-sm font-medium">Категорія ціни</div>
          <div className="text-zinc-500 text-xs mt-0.5">
            Звідки брати ціну для цього фіда й на що її множити
          </div>
        </div>
        <button onClick={() => setOpen(false)} className="text-zinc-500 hover:text-white text-sm">
          згорнути
        </button>
      </div>

      <div className="text-zinc-400 text-xs">
        Зараз у фіда:{' '}
        <span className="text-white">
          {current ? `${current.name} ×${Number(current.multiplier)}` : 'каталожна ціна'}
        </span>
        {(data?.per_product.length ?? 0) > 0 && (
          <span className="text-amber-500">
            {' · '}
            {data!.per_product.reduce((s, p) => s + p.count, 0)} товарів зі своєю категорією
          </span>
        )}
      </div>

      {/* Призначення категорії */}
      <div className="flex flex-wrap items-center gap-2">
        <select value={scope} onChange={e => setScope(e.target.value as typeof scope)}
          className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-white text-xs">
          <option value="all">усім товарам фіда</option>
          <option value="category">категорії товарів</option>
          <option value="product">одному товару</option>
        </select>

        {scope === 'category' && (
          <select value={scopeCategory} onChange={e => setScopeCategory(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-white text-xs max-w-[15rem]">
            <option value="">— оберіть категорію —</option>
            {productCategories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}

        {scope === 'product' && (
          <div className="relative">
            <input value={productQuery}
              onChange={e => { setProductQuery(e.target.value); setProductId('') }}
              placeholder="Пошук товару"
              className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-white text-xs w-56" />
            {found.length > 0 && !productId && (
              <div className="absolute z-20 left-0 right-0 mt-1 bg-zinc-800 border border-zinc-700
                              rounded max-h-48 overflow-y-auto">
                {found.map(p => (
                  <button key={p.id} onClick={() => { setProductId(p.id); setProductQuery(p.name) }}
                    className="w-full text-left px-2 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700">
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <span className="text-zinc-500 text-xs">→</span>
        <select value={chosen} onChange={e => setChosen(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-white text-xs">
          <option value="">каталожна ціна</option>
          {(data?.categories ?? []).map(c => (
            <option key={c.id} value={c.id}>
              {c.name} ×{Number(c.multiplier)}{c.source === 'bitrix' ? ' (Бітрікс)' : ''}
            </option>
          ))}
        </select>

        <button
          disabled={busy
            || (scope === 'category' && !scopeCategory)
            || (scope === 'product' && !productId)}
          onClick={() => void send({
            action: 'scope', scope,
            category_id: chosen || null,
            category_name: scope === 'category' ? scopeCategory : null,
            product_id: scope === 'product' ? productId : null,
          }, 'застосовано')}
          className="bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white text-xs
                     px-3 py-1.5 rounded transition-colors">
          Застосувати
        </button>
        {done && <span className="text-emerald-500 text-xs">{done}</span>}
        {error && <span className="text-red-400 text-xs">{error}</span>}
      </div>

      {/* Своя категорія */}
      <div className="border-t border-zinc-800 pt-3">
        <div className="text-zinc-400 text-xs mb-2">
          Своя категорія — ціна каталогу, помножена на коефіцієнт
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input value={newName} onChange={e => setNewName(e.target.value)}
            placeholder="Назва, напр. «Маркетплейс +15%»"
            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5
                       text-white text-xs w-64" />
          <span className="text-zinc-500 text-xs">×</span>
          <input value={newMultiplier}
            onChange={e => setNewMultiplier(e.target.value.replace(/[^\d.]/g, ''))}
            className="w-16 bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5
                       text-white text-xs text-center" />
          <button disabled={busy || !newName.trim()}
            onClick={() => void send({
              action: 'create', name: newName.trim(), multiplier: Number(newMultiplier),
            }, 'категорію створено').then(() => { setNewName(''); setNewMultiplier('1') })}
            className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-white text-xs
                       px-3 py-1.5 rounded transition-colors">
            Створити
          </button>
        </div>
      </div>
    </div>
  )
}

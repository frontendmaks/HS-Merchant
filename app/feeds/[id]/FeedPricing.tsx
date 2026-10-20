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
  rounding: 'none' | 'up' | 'down' | 'nearest'
  rounding_step: number
}

interface Promo {
  id: string
  feed_id: string | null
  scope: 'all' | 'category' | 'product'
  category_name: string | null
  product_id: string | null
  mode: 'percent' | 'amount'
  value: number
  product?: { name: string } | null
}

const ROUNDING_LABEL: Record<string, string> = {
  none: 'без заокруглення',
  up: 'вгору',
  down: 'вниз',
  nearest: 'до найближчого',
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
  const [newRounding, setNewRounding] = useState<'none' | 'up' | 'down' | 'nearest'>('none')
  const [newStep, setNewStep] = useState('1')

  const [promos, setPromos] = useState<Promo[]>([])
  const [promoScope, setPromoScope] = useState<'all' | 'category' | 'product'>('all')
  const [promoCategory, setPromoCategory] = useState('')
  const [promoProductQuery, setPromoProductQuery] = useState('')
  const [promoProductId, setPromoProductId] = useState('')
  const [promoMode, setPromoMode] = useState<'percent' | 'amount'>('percent')
  const [promoValue, setPromoValue] = useState('15')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  async function load() {
    const [pricing, promoList] = await Promise.all([
      fetch(`/api/feeds/${feedId}/pricing`),
      fetch(`/api/feeds/${feedId}/promos`),
    ])
    if (pricing.ok) {
      const d = await pricing.json()
      setData(d)
      setChosen(d.feed_category_id ?? '')
    }
    if (promoList.ok) setPromos((await promoList.json()).promos ?? [])
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
        className="bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-xl
                   px-4 py-2.5 text-sm text-white transition-colors flex items-center gap-2">
        <span>₴</span>
        <span>Ціни фіда</span>
        <span className="text-zinc-500 text-xs">категорія, заокруглення, акція</span>
      </button>
    )
  }

  const current = data?.categories.find(c => c.id === data.feed_category_id)

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-white text-sm font-medium">Ціни фіда</div>
          <div className="text-zinc-500 text-xs mt-0.5">
            Звідки брати ціну, як її заокруглювати та де намалювати стару
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

      {/* Свої категорії */}
      <div className="border-t border-zinc-800 pt-3">
        <div className="text-zinc-400 text-xs mb-2">
          Своя категорія — ціна каталогу, помножена на коефіцієнт і заокруглена
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input value={newName} onChange={e => setNewName(e.target.value)}
            placeholder="Назва, напр. «Маркетплейс +15%»"
            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5
                       text-white text-xs w-56" />
          <span className="text-zinc-500 text-xs">×</span>
          <input value={newMultiplier}
            onChange={e => setNewMultiplier(e.target.value.replace(/[^\d.]/g, ''))}
            className="w-14 bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5
                       text-white text-xs text-center" />

          <select value={newRounding}
            onChange={e => setNewRounding(e.target.value as typeof newRounding)}
            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-white text-xs">
            <option value="none">без заокруглення</option>
            <option value="up">заокруглити вгору</option>
            <option value="down">заокруглити вниз</option>
            <option value="nearest">до найближчого</option>
          </select>

          {newRounding !== 'none' && (
            <>
              <span className="text-zinc-500 text-xs">до</span>
              <input value={newStep}
                onChange={e => setNewStep(e.target.value.replace(/[^\d.]/g, ''))}
                className="w-14 bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5
                           text-white text-xs text-center" />
              <span className="text-zinc-500 text-xs">₴</span>
            </>
          )}

          <button disabled={busy || !newName.trim()}
            onClick={() => void send({
              action: 'create', name: newName.trim(), multiplier: Number(newMultiplier),
              rounding: newRounding, rounding_step: Number(newStep) || 1,
            }, 'категорію створено').then(() => {
              setNewName(''); setNewMultiplier('1'); setNewRounding('none'); setNewStep('1')
            })}
            className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-white text-xs
                       px-3 py-1.5 rounded transition-colors">
            Створити
          </button>
        </div>

        {(data?.categories ?? []).length > 0 && (
          <div className="space-y-1 mt-2">
            {data!.categories.map(c => (
              <div key={c.id} className="flex items-center gap-2 text-xs">
                <span className="text-zinc-300 min-w-0 flex-1 truncate">
                  {c.name}
                  <span className="text-zinc-600">
                    {' · '}×{Number(c.multiplier)}
                    {c.rounding !== 'none'
                      && ` · ${ROUNDING_LABEL[c.rounding]} до ${Number(c.rounding_step)} ₴`}
                    {c.source === 'bitrix' && ' · з Бітрікса'}
                  </span>
                </span>
                {c.is_system
                  ? <span className="text-zinc-600">вбудована</span>
                  : (
                    <button
                      onClick={() => void fetch(
                        `/api/feeds/${feedId}/pricing?category=${c.id}`, { method: 'DELETE' },
                      ).then(load)}
                      className="text-zinc-600 hover:text-red-400 transition-colors">✕</button>
                  )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Штучна акція */}
      <div className="border-t border-zinc-800 pt-3">
        <div className="text-zinc-400 text-xs mb-2">
          Штучна акція — піднімає перекреслену стару ціну, чинну не чіпає
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={promoScope}
            onChange={e => setPromoScope(e.target.value as typeof promoScope)}
            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-white text-xs">
            <option value="all">усім товарам</option>
            <option value="category">категорії</option>
            <option value="product">одному товару</option>
          </select>

          {promoScope === 'category' && (
            <select value={promoCategory} onChange={e => setPromoCategory(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5
                         text-white text-xs max-w-[14rem]">
              <option value="">— оберіть категорію —</option>
              {productCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}

          {promoScope === 'product' && (
            <div className="relative">
              <input value={promoProductQuery}
                onChange={e => { setPromoProductQuery(e.target.value); setPromoProductId('') }}
                placeholder="Пошук товару"
                className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5
                           text-white text-xs w-52" />
              {promoProductQuery.trim().length >= 2 && !promoProductId && (
                <div className="absolute z-20 left-0 right-0 mt-1 bg-zinc-800 border
                                border-zinc-700 rounded max-h-48 overflow-y-auto">
                  {products
                    .filter(p => p.name.toLowerCase()
                      .includes(promoProductQuery.trim().toLowerCase()))
                    .slice(0, 8)
                    .map(p => (
                      <button key={p.id}
                        onClick={() => { setPromoProductId(p.id); setPromoProductQuery(p.name) }}
                        className="w-full text-left px-2 py-1.5 text-xs text-zinc-200
                                   hover:bg-zinc-700">
                        {p.name}
                      </button>
                    ))}
                </div>
              )}
            </div>
          )}

          <span className="text-zinc-500 text-xs">підняти на</span>
          <input value={promoValue}
            onChange={e => setPromoValue(e.target.value.replace(/[^\d.]/g, ''))}
            className="w-14 bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5
                       text-white text-xs text-center" />
          <select value={promoMode}
            onChange={e => setPromoMode(e.target.value as typeof promoMode)}
            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-white text-xs">
            <option value="percent">%</option>
            <option value="amount">₴</option>
          </select>

          <button
            disabled={busy
              || (promoScope === 'category' && !promoCategory)
              || (promoScope === 'product' && !promoProductId)}
            onClick={async () => {
              setBusy(true); setError(''); setDone('')
              const r = await fetch(`/api/feeds/${feedId}/promos`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  scope: promoScope, mode: promoMode, value: Number(promoValue),
                  category_name: promoScope === 'category' ? promoCategory : null,
                  product_id: promoScope === 'product' ? promoProductId : null,
                }),
              })
              const d = await r.json().catch(() => ({}))
              if (!r.ok) setError(d.error || 'Не зберіглось')
              else { setDone('акцію додано'); await load(); router.refresh() }
              setBusy(false)
            }}
            className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-white text-xs
                       px-3 py-1.5 rounded transition-colors">
            Додати
          </button>
        </div>

        {promos.length > 0 && (
          <div className="space-y-1 mt-2">
            {promos.map(p => (
              <div key={p.id} className="flex items-center gap-2 text-xs">
                <span className="text-zinc-300 min-w-0 flex-1 truncate">
                  {p.scope === 'all' ? 'усі товари фіда'
                    : p.scope === 'category' ? `категорія «${p.category_name}»`
                    : p.product?.name ?? 'товар'}
                </span>
                <span className="text-white whitespace-nowrap">
                  +{Number(p.value)}{p.mode === 'percent' ? '%' : ' ₴'}
                </span>
                {!p.feed_id && <span className="text-zinc-600">спільне</span>}
                <button
                  onClick={() => void fetch(
                    `/api/feeds/${feedId}/promos?promo=${p.id}`, { method: 'DELETE' },
                  ).then(load)}
                  className="text-zinc-600 hover:text-red-400 transition-colors">✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  )
}

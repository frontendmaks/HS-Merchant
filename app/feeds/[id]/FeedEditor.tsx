'use client'
import { useState, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'

type Product = {
  id: string
  name: string
  category_name: string | null
  brand: string | null
  price: number
  stock: number | null
  images: string[]
}

type FeedProduct = {
  id: string
  product_id: string
  is_active: boolean
  custom_price: number | null
  custom_stock: number | null
  custom_name: string | null
}

type Feed = {
  id: string
  name: string
  slug: string
  status: string
  settings: any
  marketplace_id: string
}

type Props = {
  feed: Feed
  feedProducts: FeedProduct[]
  allProducts: Product[]
  categories: string[]
  marketplaces: { id: string; name: string }[]
}

type Override = {
  custom_price?: string
  custom_stock?: string
  is_active?: boolean
}

export default function FeedEditor({ feed, feedProducts, allProducts, categories, marketplaces }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)

  const [feedName, setFeedName] = useState(feed.name)
  const [feedSlug, setFeedSlug] = useState(feed.slug)
  const [status, setStatus] = useState(feed.status)
  const [trigger, setTrigger] = useState(feed.settings?.trigger ?? 'manual')
  const [cronExpr, setCronExpr] = useState(feed.settings?.cron ?? '0 * * * *')
  const [filterType, setFilterType] = useState(feed.settings?.filter?.type ?? 'all')
  const [selectedCategories, setSelectedCategories] = useState<string[]>(feed.settings?.filter?.categories ?? [])

  // Build overrides map — only from saved feed_products, everything else defaults to inactive
  const fpMap = useMemo(() => new Map(feedProducts.map(fp => [fp.product_id, fp])), [feedProducts])

  const [overrides, setOverrides] = useState<Record<string, Override>>(
    Object.fromEntries(feedProducts.map(fp => [fp.product_id, {
      custom_price: fp.custom_price != null ? String(fp.custom_price) : '',
      custom_stock: fp.custom_stock != null ? String(fp.custom_stock) : '',
      is_active: fp.is_active,
    }]))
  )

  const [productSearch, setProductSearch] = useState('')

  // Filtered products list based on category filter setting
  const filteredProducts = useMemo(() => allProducts.filter(p => {
    if (filterType === 'categories' && selectedCategories.length > 0) {
      if (!p.category_name || !selectedCategories.includes(p.category_name)) return false
    }
    if (productSearch) {
      return p.name.toLowerCase().includes(productSearch.toLowerCase())
    }
    return true
  }), [allProducts, filterType, selectedCategories, productSearch])

  // Count actually selected (active) products across ALL products
  const selectedCount = useMemo(() =>
    allProducts.filter(p => overrides[p.id]?.is_active === true).length,
    [allProducts, overrides]
  )

  const toggleCategory = (cat: string) => {
    setSelectedCategories(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    )
  }

  const setOverride = (productId: string, field: keyof Override, value: string | boolean) => {
    setOverrides(prev => ({
      ...prev,
      [productId]: { ...prev[productId], [field]: value }
    }))
  }

  const selectAllVisible = () => {
    const updates: Record<string, Override> = {}
    filteredProducts.forEach(p => {
      updates[p.id] = { ...overrides[p.id], is_active: true }
    })
    setOverrides(prev => ({ ...prev, ...updates }))
  }

  const deselectAllVisible = () => {
    const updates: Record<string, Override> = {}
    filteredProducts.forEach(p => {
      updates[p.id] = { ...overrides[p.id], is_active: false }
    })
    setOverrides(prev => ({ ...prev, ...updates }))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      // Only send overrides that have been explicitly set
      const res = await fetch(`/api/feeds/${feed.id}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: feedName,
          slug: feedSlug,
          status,
          settings: {
            trigger,
            cron: trigger === 'scheduled' ? cronExpr : undefined,
            filter: {
              type: filterType,
              categories: filterType === 'categories' ? selectedCategories : [],
            },
          },
          overrides,
        }),
      })
      const data = await res.json()
      if (data.success) {
        startTransition(() => router.refresh())
        alert('✅ Збережено!')
      } else {
        alert('❌ Помилка: ' + data.error)
      }
    } finally {
      setSaving(false)
    }
  }

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      window.open(`/api/feeds/${feed.slug}`, '_blank')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-6">
        <div className="flex-1 min-w-0 space-y-1">
          <input
            value={feedName}
            onChange={e => setFeedName(e.target.value)}
            className="text-2xl font-semibold text-white bg-transparent border-b border-transparent hover:border-zinc-700 focus:border-red-500 focus:outline-none w-full transition-colors"
            placeholder="Назва фіду"
          />
          <div className="flex items-center gap-1 text-xs text-zinc-500 font-mono">
            <span className="text-zinc-600">/api/feeds/</span>
            <input
              value={feedSlug}
              onChange={e => setFeedSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
              className="bg-transparent border-b border-transparent hover:border-zinc-700 focus:border-red-500 focus:outline-none text-zinc-400 transition-colors"
              placeholder="slug"
            />
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-sm rounded-lg transition-colors"
          >
            ↗ Переглянути XML
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {saving ? 'Збереження...' : '✓ Зберегти'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* === SETTINGS === */}
        <div className="space-y-4">
          {/* Status */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-white mb-4">Налаштування фіду</h2>
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Статус</label>
              <select
                value={status}
                onChange={e => setStatus(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-red-500"
              >
                <option value="active">Активний</option>
                <option value="draft">Чернетка</option>
                <option value="inactive">Вимкнений</option>
              </select>
            </div>
          </div>

          {/* Trigger */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-white mb-4">⏱ Тригер оновлення</h2>
            <div className="space-y-3">
              {[
                { value: 'manual', label: '🖱 Вручну', desc: 'Оновлення тільки при відкритті URL' },
                { value: 'scheduled', label: '⏱ За розкладом', desc: 'Кешується автоматично по cron' },
                { value: 'webhook', label: '🔗 Вебхук', desc: 'Тригер при зміні товарів у WC' },
              ].map(opt => (
                <label key={opt.value} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  trigger === opt.value ? 'border-red-600 bg-red-950/30' : 'border-zinc-800 hover:border-zinc-600'
                }`}>
                  <input
                    type="radio"
                    name="trigger"
                    value={opt.value}
                    checked={trigger === opt.value}
                    onChange={() => setTrigger(opt.value)}
                    className="mt-0.5 accent-red-500"
                  />
                  <div>
                    <div className="text-sm text-white">{opt.label}</div>
                    <div className="text-xs text-zinc-500">{opt.desc}</div>
                  </div>
                </label>
              ))}

              {trigger === 'scheduled' && (
                <div className="mt-2">
                  <label className="text-xs text-zinc-500 mb-1 block">Cron вираз</label>
                  <input
                    value={cronExpr}
                    onChange={e => setCronExpr(e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-red-500"
                    placeholder="0 * * * *"
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    {[
                      ['Щогодини', '0 * * * *'],
                      ['Кожні 6год', '0 */6 * * *'],
                      ['Щодня о 6:00', '0 6 * * *'],
                      ['Щодня о 00:00', '0 0 * * *'],
                    ].map(([label, cron]) => (
                      <button
                        key={cron}
                        onClick={() => setCronExpr(cron)}
                        className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded transition-colors"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {trigger === 'webhook' && (
                <div className="text-xs text-zinc-500 bg-zinc-800 rounded-lg p-3 mt-2 leading-relaxed">
                  WooCommerce → Налаштування → Вебхуки → Додати:<br />
                  <span className="font-mono text-zinc-300 text-[11px]">POST https://hs-merchant.vercel.app/api/sync/woocommerce</span>
                </div>
              )}
            </div>
          </div>

          {/* Filter */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-white mb-4">🗂 Фільтр товарів у таблиці</h2>
            <p className="text-xs text-zinc-600 mb-3">Звужує список товарів праворуч для зручнішого вибору</p>
            <div className="space-y-3">
              {[
                { value: 'all', label: 'Всі товари', desc: 'Показувати весь каталог' },
                { value: 'categories', label: 'За категоріями', desc: 'Тільки обрані категорії' },
              ].map(opt => (
                <label key={opt.value} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  filterType === opt.value ? 'border-red-600 bg-red-950/30' : 'border-zinc-800 hover:border-zinc-600'
                }`}>
                  <input
                    type="radio"
                    name="filterType"
                    value={opt.value}
                    checked={filterType === opt.value}
                    onChange={() => setFilterType(opt.value)}
                    className="mt-0.5 accent-red-500"
                  />
                  <div>
                    <div className="text-sm text-white">{opt.label}</div>
                    <div className="text-xs text-zinc-500">{opt.desc}</div>
                  </div>
                </label>
              ))}

              {filterType === 'categories' && (
                <div className="mt-2 flex flex-wrap gap-2 max-h-48 overflow-y-auto">
                  {categories.map(cat => (
                    <button
                      key={cat}
                      onClick={() => toggleCategory(cat)}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                        selectedCategories.includes(cat)
                          ? 'bg-red-600 border-red-600 text-white'
                          : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-500'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* === PRODUCTS TABLE === */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden flex flex-col">
          {/* Header */}
          <div className="px-5 py-4 border-b border-zinc-800 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-white">
                  Товари у фіді
                </h2>
                <div className="text-xs text-zinc-500 mt-0.5">
                  <span className="text-emerald-400 font-medium">{selectedCount}</span> вибрано
                  <span className="mx-1.5 text-zinc-700">·</span>
                  {allProducts.length} всього
                </div>
              </div>
              <input
                type="text"
                placeholder="Пошук..."
                value={productSearch}
                onChange={e => setProductSearch(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-red-500 w-40"
              />
            </div>

            {/* Bulk actions */}
            <div className="flex items-center gap-2">
              <button
                onClick={selectAllVisible}
                className="text-xs px-3 py-1.5 bg-emerald-900/40 hover:bg-emerald-900/60 border border-emerald-800 text-emerald-400 rounded-lg transition-colors"
              >
                ✓ Вибрати всі видимі ({filteredProducts.length})
              </button>
              <button
                onClick={deselectAllVisible}
                className="text-xs px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-400 rounded-lg transition-colors"
              >
                ✕ Зняти всі видимі
              </button>
            </div>
          </div>

          {/* Column headers */}
          <div className="grid grid-cols-[24px_1fr_90px_90px] gap-2 px-5 py-2 bg-zinc-800/50 border-b border-zinc-800">
            <div className="text-xs text-zinc-600">✓</div>
            <div className="text-xs text-zinc-600 uppercase tracking-wide">Товар</div>
            <div className="text-xs text-zinc-600 uppercase tracking-wide text-right">Ціна</div>
            <div className="text-xs text-zinc-600 uppercase tracking-wide text-right">Залишок</div>
          </div>

          <div className="overflow-y-auto flex-1 max-h-[560px] divide-y divide-zinc-800">
            {filteredProducts.length === 0 && (
              <div className="py-12 text-center text-zinc-600 text-sm">Немає товарів</div>
            )}
            {filteredProducts.slice(0, 500).map(p => {
              const ov = overrides[p.id] ?? {}
              // Default: unchecked unless explicitly set to true in feed_products
              const isActive = ov.is_active === true

              return (
                <div key={p.id} className={`grid grid-cols-[24px_1fr_90px_90px] gap-2 px-5 py-2.5 items-center transition-colors ${
                  isActive ? 'hover:bg-zinc-800/40' : 'opacity-40 hover:bg-zinc-800/20'
                }`}>
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={e => setOverride(p.id, 'is_active', e.target.checked)}
                    className="accent-red-500 cursor-pointer"
                  />

                  <div className="min-w-0">
                    <div className="text-xs text-zinc-300 truncate">{p.name}</div>
                    <div className="text-xs text-zinc-600">{p.category_name}</div>
                  </div>

                  <div>
                    <input
                      type="number"
                      placeholder={String(p.price ?? '')}
                      value={ov.custom_price ?? ''}
                      onChange={e => setOverride(p.id, 'custom_price', e.target.value)}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-white text-right focus:outline-none focus:border-amber-500 placeholder:text-zinc-600"
                    />
                  </div>

                  <div>
                    <input
                      type="number"
                      placeholder={p.stock != null ? String(p.stock) : '∞'}
                      value={ov.custom_stock ?? ''}
                      onChange={e => setOverride(p.id, 'custom_stock', e.target.value)}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-white text-right focus:outline-none focus:border-blue-500 placeholder:text-zinc-600"
                    />
                  </div>
                </div>
              )
            })}
          </div>

          {filteredProducts.length > 500 && (
            <div className="px-5 py-2 border-t border-zinc-800 text-xs text-zinc-600 text-center">
              Показано 500 з {filteredProducts.length}. Уточніть пошук або категорію.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

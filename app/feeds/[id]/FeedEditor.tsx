'use client'
import { useState, useTransition } from 'react'
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

export default function FeedEditor({ feed, feedProducts, allProducts, categories, marketplaces }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)

  // Settings state
  const [status, setStatus] = useState(feed.status)
  const [trigger, setTrigger] = useState(feed.settings?.trigger ?? 'manual')
  const [cronExpr, setCronExpr] = useState(feed.settings?.cron ?? '0 * * * *')
  const [filterType, setFilterType] = useState(feed.settings?.filter?.type ?? 'all')
  const [selectedCategories, setSelectedCategories] = useState<string[]>(feed.settings?.filter?.categories ?? [])

  // Products overrides
  const fpMap = new Map(feedProducts.map(fp => [fp.product_id, fp]))
  const [overrides, setOverrides] = useState<Record<string, { custom_price?: string; custom_stock?: string; is_active?: boolean }>>(
    Object.fromEntries(feedProducts.map(fp => [fp.product_id, {
      custom_price: fp.custom_price != null ? String(fp.custom_price) : '',
      custom_stock: fp.custom_stock != null ? String(fp.custom_stock) : '',
      is_active: fp.is_active,
    }]))
  )

  const [productSearch, setProductSearch] = useState('')

  // Filtered products based on settings
  const filteredProducts = allProducts.filter(p => {
    if (filterType === 'categories' && selectedCategories.length > 0) {
      if (!p.category_name || !selectedCategories.includes(p.category_name)) return false
    }
    if (productSearch) {
      return p.name.toLowerCase().includes(productSearch.toLowerCase())
    }
    return true
  })

  const toggleCategory = (cat: string) => {
    setSelectedCategories(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    )
  }

  const setOverride = (productId: string, field: string, value: string | boolean) => {
    setOverrides(prev => ({
      ...prev,
      [productId]: { ...prev[productId], [field]: value }
    }))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/feeds/${feed.id}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
      const res = await fetch(`/api/feeds/${feed.slug}`)
      if (res.ok) {
        window.open(`/api/feeds/${feed.slug}`, '_blank')
      }
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">{feed.name}</h1>
          <div className="text-xs text-zinc-500 font-mono mt-1">/api/feeds/{feed.slug}</div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-sm rounded-lg transition-colors"
          >
            {generating ? '⏳' : '↗'} Переглянути XML
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
            <div className="space-y-3">
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
          </div>

          {/* Trigger */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-white mb-4">⏱ Тригер оновлення</h2>
            <div className="space-y-3">
              {[
                { value: 'manual', label: '🖱 Вручну', desc: 'Оновлення тільки при запиті' },
                { value: 'scheduled', label: '⏱ За розкладом', desc: 'Автоматично по cron' },
                { value: 'webhook', label: '🔗 Вебхук', desc: 'При зміні товарів у WC' },
              ].map(opt => (
                <label key={opt.value} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  trigger === opt.value
                    ? 'border-red-600 bg-red-950/30'
                    : 'border-zinc-800 hover:border-zinc-600'
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
                  <div className="mt-1 flex flex-wrap gap-2">
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
                <div className="text-xs text-zinc-500 bg-zinc-800 rounded-lg p-3 mt-2">
                  Додай у WooCommerce → Налаштування → Вебхуки:<br />
                  <span className="font-mono text-zinc-300">POST https://hs-merchant.vercel.app/api/sync/woocommerce</span>
                </div>
              )}
            </div>
          </div>

          {/* Filter */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-white mb-4">🗂 Фільтр товарів</h2>
            <div className="space-y-3">
              {[
                { value: 'all', label: 'Всі товари', desc: 'Включати всі активні товари' },
                { value: 'categories', label: 'За категоріями', desc: 'Обрати конкретні категорії' },
              ].map(opt => (
                <label key={opt.value} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  filterType === opt.value
                    ? 'border-red-600 bg-red-950/30'
                    : 'border-zinc-800 hover:border-zinc-600'
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
          <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-white shrink-0">
              Товари у фіді
              <span className="ml-2 text-xs text-zinc-500 font-normal">{filteredProducts.length} шт</span>
            </h2>
            <input
              type="text"
              placeholder="Пошук..."
              value={productSearch}
              onChange={e => setProductSearch(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-red-500 w-44"
            />
          </div>

          {/* Column headers */}
          <div className="grid grid-cols-[24px_1fr_90px_90px] gap-2 px-5 py-2 bg-zinc-800/50 border-b border-zinc-800">
            <div className="text-xs text-zinc-600">✓</div>
            <div className="text-xs text-zinc-600 uppercase tracking-wide">Товар</div>
            <div className="text-xs text-zinc-600 uppercase tracking-wide text-right">Ціна</div>
            <div className="text-xs text-zinc-600 uppercase tracking-wide text-right">Залишок</div>
          </div>

          <div className="overflow-y-auto flex-1 max-h-[600px] divide-y divide-zinc-800">
            {filteredProducts.slice(0, 100).map(p => {
              const ov = overrides[p.id] ?? {}
              const isActive = ov.is_active !== undefined ? ov.is_active : true
              const inFeed = fpMap.has(p.id)

              return (
                <div key={p.id} className={`grid grid-cols-[24px_1fr_90px_90px] gap-2 px-5 py-2.5 items-center transition-colors ${
                  isActive ? 'hover:bg-zinc-800/40' : 'opacity-40 hover:bg-zinc-800/20'
                }`}>
                  {/* Toggle */}
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={e => setOverride(p.id, 'is_active', e.target.checked)}
                    className="accent-red-500 cursor-pointer"
                  />

                  {/* Name */}
                  <div className="min-w-0">
                    <div className="text-xs text-zinc-300 truncate">{p.name}</div>
                    <div className="text-xs text-zinc-600">{p.category_name}</div>
                  </div>

                  {/* Custom price */}
                  <div>
                    <input
                      type="number"
                      placeholder={String(p.price ?? '')}
                      value={ov.custom_price ?? ''}
                      onChange={e => setOverride(p.id, 'custom_price', e.target.value)}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-white text-right focus:outline-none focus:border-amber-500 placeholder:text-zinc-600"
                    />
                  </div>

                  {/* Custom stock */}
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
        </div>
      </div>
    </div>
  )
}

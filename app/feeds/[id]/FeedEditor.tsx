'use client'
import { useState, useTransition, useMemo, useEffect } from 'react'
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
  name_ru: string | null
  description_ru: string | null
}

type Feed = {
  id: string
  name: string
  slug: string
  status: string
  settings: any
  marketplace_id: string
  marketplace?: { id: string; name: string; slug: string } | null
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
  name_ru?: string
  description_ru?: string
}

/** Combo: select from known MauDau cats OR type a custom slug */
function CategoryPortalRow({
  catName, value, maudauCategories, onChange,
}: {
  catName: string
  value: string
  maudauCategories: { slug: string; title: string }[]
  onChange: (v: string) => void
}) {
  const [mode, setMode] = useState<'select' | 'manual'>('select')

  // If saved value doesn't match any known slug — switch to manual automatically
  const knownSlugs = maudauCategories.map(c => c.slug)
  const isKnown = !value || knownSlugs.includes(value)

  const effectiveMode = (!isKnown || mode === 'manual') ? 'manual' : 'select'

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-zinc-300 flex-1 min-w-0 truncate">{catName}</span>
      <span className="text-zinc-600 text-xs shrink-0">→</span>

      {effectiveMode === 'select' ? (
        <>
          <select
            value={value}
            onChange={e => onChange(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-white w-44 focus:outline-none focus:border-purple-500"
          >
            <option value="">— оберіть —</option>
            {maudauCategories.map(mc => (
              <option key={mc.slug} value={mc.slug}>{mc.title}</option>
            ))}
          </select>
          <button
            onClick={() => setMode('manual')}
            title="Ввести slug вручну"
            className="text-zinc-600 hover:text-zinc-400 text-xs shrink-0"
          >✏️</button>
        </>
      ) : (
        <>
          <input
            type="text"
            placeholder="slug категорії MauDau"
            value={value}
            onChange={e => onChange(e.target.value)}
            className="bg-zinc-800 border border-purple-700 rounded px-2 py-1 text-xs text-white font-mono w-44 focus:outline-none focus:border-purple-500"
          />
          {maudauCategories.length > 0 && (
            <button
              onClick={() => { setMode('select'); onChange('') }}
              title="Обрати зі списку"
              className="text-zinc-600 hover:text-zinc-400 text-xs shrink-0"
            >📋</button>
          )}
        </>
      )}
    </div>
  )
}

export default function FeedEditor({ feed, feedProducts, allProducts, categories, marketplaces }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)

  const isMaudau = feed.marketplace?.slug === 'maudau' || feed.marketplace?.name?.toLowerCase().includes('maudau')

  // MauDau: available categories fetched from API / DB
  const [maudauCategories, setMaudauCategories] = useState<{ slug: string; title: string }[]>([])
  const [maudauCatsLoading, setMaudauCatsLoading] = useState(false)
  const [maudauCatsError, setMaudauCatsError] = useState('')
  const [maudauCatsSource, setMaudauCatsSource] = useState<'db' | 'api' | ''>('')
  const [xlsxUploading, setXlsxUploading] = useState(false)
  const [xlsxMsg, setXlsxMsg] = useState('')

  const loadMaudauCategories = () => {
    setMaudauCatsLoading(true)
    setMaudauCatsError('')
    fetch('/api/maudau/categories')
      .then(r => r.json())
      .then(d => {
        setMaudauCategories(d.categories ?? [])
        setMaudauCatsSource(d.source ?? '')
        if (d.error) setMaudauCatsError('Не вдалося завантажити категорії MauDau')
      })
      .catch(() => setMaudauCatsError('Не вдалося завантажити категорії MauDau'))
      .finally(() => setMaudauCatsLoading(false))
  }

  useEffect(() => {
    if (!isMaudau) return
    loadMaudauCategories()
  }, [isMaudau])

  const handleXlsxUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setXlsxUploading(true)
    setXlsxMsg('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/maudau/import-categories', { method: 'POST', body: fd })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)
      setXlsxMsg(`✅ Імпортовано ${data.count} категорій`)
      loadMaudauCategories()
    } catch (err: any) {
      setXlsxMsg('❌ ' + (err.message ?? 'Помилка імпорту'))
    } finally {
      setXlsxUploading(false)
      e.target.value = ''
    }
  }

  const [feedName, setFeedName] = useState(feed.name)
  const [feedSlug, setFeedSlug] = useState(feed.slug)
  const [status, setStatus] = useState(feed.status)
  const [trigger, setTrigger] = useState(feed.settings?.trigger ?? 'manual')
  const [cronExpr, setCronExpr] = useState(feed.settings?.cron ?? '0 * * * *')
  const [filterType, setFilterType] = useState(feed.settings?.filter?.type ?? 'all')
  const [selectedCategories, setSelectedCategories] = useState<string[]>(feed.settings?.filter?.categories ?? [])
  // MauDau: portal_id per category name
  const [categoryPortalIds, setCategoryPortalIds] = useState<Record<string, string>>(
    feed.settings?.category_portal_ids ?? {}
  )

  // Build overrides map — only from saved feed_products, everything else defaults to inactive
  const fpMap = useMemo(() => new Map(feedProducts.map(fp => [fp.product_id, fp])), [feedProducts])

  const [overrides, setOverrides] = useState<Record<string, Override>>(
    Object.fromEntries(feedProducts.map(fp => [fp.product_id, {
      custom_price: fp.custom_price != null ? String(fp.custom_price) : '',
      custom_stock: fp.custom_stock != null ? String(fp.custom_stock) : '',
      is_active: fp.is_active,
      name_ru: fp.name_ru ?? '',
      description_ru: fp.description_ru ?? '',
    }]))
  )

  const [productSearch, setProductSearch] = useState('')
  // Which product row is expanded (for MauDau extra fields)
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null)

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

  // Active categories (derived from selected products) for MauDau portal_id section
  const activeCategories = useMemo(() => {
    const cats = new Set<string>()
    allProducts.forEach(p => {
      if (overrides[p.id]?.is_active === true && p.category_name) {
        cats.add(p.category_name)
      }
    })
    return [...cats].sort()
  }, [allProducts, overrides])

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
            ...(isMaudau ? { category_portal_ids: categoryPortalIds } : {}),
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

          {/* MauDau: Category portal_id mapping */}
          {isMaudau && (
            <div className="bg-zinc-900 border border-purple-900/50 rounded-xl p-5">
              <div className="flex items-start justify-between gap-2 mb-1">
                <h2 className="text-sm font-semibold text-white">🟣 MauDau — категорії</h2>
                {maudauCatsLoading && <span className="text-xs text-zinc-500">Завантаження...</span>}
              </div>
              <p className="text-xs text-zinc-500 mb-3">
                Зіставте свої категорії з категоріями MauDau.
                {maudauCatsSource === 'db'
                  ? <span className="text-emerald-500"> • {maudauCategories.length} кат. з файлу</span>
                  : maudauCatsSource === 'api'
                  ? <span className="text-amber-500"> • {maudauCategories.length} кат. з API (лише наявні)</span>
                  : null}
              </p>

              {maudauCatsError && (
                <p className="text-xs text-red-400 mb-3">{maudauCatsError}</p>
              )}
              {activeCategories.length === 0 ? (
                <p className="text-xs text-zinc-600">Спочатку виберіть товари праворуч.</p>
              ) : (
                <div className="space-y-2">
                  {activeCategories.map(cat => (
                    <CategoryPortalRow
                      key={cat}
                      catName={cat}
                      value={categoryPortalIds[cat] ?? ''}
                      maudauCategories={maudauCategories}
                      onChange={v => setCategoryPortalIds(prev => ({ ...prev, [cat]: v }))}
                    />
                  ))}
                </div>
              )}
              {maudauCategories.length === 0 && !maudauCatsLoading && !maudauCatsError && (
                <p className="text-xs text-zinc-600 mt-3">
                  Категорії не знайдено — переконайтеся що є активні товари в кабінеті MauDau,
                  або введіть slug вручну.
                </p>
              )}
            </div>
          )}
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
          <div className={`grid gap-2 px-5 py-2 bg-zinc-800/50 border-b border-zinc-800 ${isMaudau ? 'grid-cols-[24px_1fr_80px]' : 'grid-cols-[24px_1fr_90px_90px]'}`}>
            <div className="text-xs text-zinc-600">✓</div>
            <div className="text-xs text-zinc-600 uppercase tracking-wide">Товар</div>
            <div className="text-xs text-zinc-600 uppercase tracking-wide text-right">Ціна</div>
            {!isMaudau && <div className="text-xs text-zinc-600 uppercase tracking-wide text-right">Залишок</div>}
          </div>

          <div className="overflow-y-auto flex-1 max-h-[560px] divide-y divide-zinc-800">
            {filteredProducts.length === 0 && (
              <div className="py-12 text-center text-zinc-600 text-sm">Немає товарів</div>
            )}
            {filteredProducts.slice(0, 500).map(p => {
              const ov = overrides[p.id] ?? {}
              const isActive = ov.is_active === true
              const isExpanded = expandedProduct === p.id

              return (
                <div key={p.id} className={`transition-colors ${isActive ? 'hover:bg-zinc-800/30' : 'opacity-40 hover:bg-zinc-800/20'}`}>
                  <div className={`grid gap-2 px-5 py-2.5 items-center ${isMaudau ? 'grid-cols-[24px_1fr_80px]' : 'grid-cols-[24px_1fr_90px_90px]'}`}>
                    <input
                      type="checkbox"
                      checked={isActive}
                      onChange={e => setOverride(p.id, 'is_active', e.target.checked)}
                      className="accent-red-500 cursor-pointer"
                    />

                    <div className="min-w-0">
                      <button
                        onClick={() => isMaudau && setExpandedProduct(isExpanded ? null : p.id)}
                        className={`text-left w-full ${isMaudau ? 'cursor-pointer' : 'cursor-default'}`}
                      >
                        <div className="text-xs text-zinc-300 truncate">
                          {isMaudau && <span className="text-zinc-600 mr-1">{isExpanded ? '▾' : '▸'}</span>}
                          {p.name}
                        </div>
                        <div className="text-xs text-zinc-600">{p.category_name}</div>
                      </button>
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

                    {!isMaudau && (
                      <div>
                        <input
                          type="number"
                          placeholder={p.stock != null ? String(p.stock) : '∞'}
                          value={ov.custom_stock ?? ''}
                          onChange={e => setOverride(p.id, 'custom_stock', e.target.value)}
                          className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-white text-right focus:outline-none focus:border-blue-500 placeholder:text-zinc-600"
                        />
                      </div>
                    )}
                  </div>

                  {/* MauDau expanded: name_ru + description_ru */}
                  {isMaudau && isExpanded && (
                    <div className="px-5 pb-3 space-y-2 bg-purple-950/10 border-t border-zinc-800/60">
                      <p className="text-[11px] text-zinc-600 pt-2">Назва та опис російською (необов'язково — якщо не вказано, буде використано українські)</p>
                      <div>
                        <label className="text-[11px] text-zinc-500 block mb-0.5">name_ru</label>
                        <input
                          type="text"
                          placeholder={p.name}
                          value={ov.name_ru ?? ''}
                          onChange={e => setOverride(p.id, 'name_ru', e.target.value)}
                          className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-purple-500 placeholder:text-zinc-600"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-zinc-500 block mb-0.5">description_ru</label>
                        <textarea
                          rows={2}
                          placeholder="Опис рос. мовою (за замовчуванням — укр.)"
                          value={ov.description_ru ?? ''}
                          onChange={e => setOverride(p.id, 'description_ru', e.target.value)}
                          className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-purple-500 placeholder:text-zinc-600 resize-none"
                        />
                      </div>
                    </div>
                  )}
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

      {/* MauDau: feed URL info */}
      {isMaudau && (
        <div className="bg-zinc-900 border border-purple-900/40 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-white mb-2">🟣 URL фіду для MauDau</h2>
          <p className="text-xs text-zinc-500 mb-3">
            Вкажіть цей URL у особистому кабінеті MauDau для автоматичного імпорту товарів.
            Фід оновлюється відповідно до налаштованого тригеру (рекомендовано: щодня о 6:00).
          </p>
          <div className="flex items-center gap-3">
            <code className="text-xs font-mono text-purple-300 bg-zinc-800 px-3 py-2 rounded-lg flex-1 select-all">
              https://hs-merchant.vercel.app/api/feeds/{feedSlug}
            </code>
            <button
              onClick={() => navigator.clipboard.writeText(`https://hs-merchant.vercel.app/api/feeds/${feedSlug}`)}
              className="text-xs px-3 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-400 rounded-lg transition-colors whitespace-nowrap"
            >
              Копіювати
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

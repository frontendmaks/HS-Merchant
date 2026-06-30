'use client'
import { useState, useTransition, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'

type Product = {
  id: string
  name: string
  description: string | null
  category_name: string | null
  brand: string | null
  price: number
  price_old: number | null
  stock: number | null
  images: string[]
  attributes: Record<string, string> | null
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
  custom_params: Record<string, string> | null
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
  custom_params?: Record<string, string>
}

/** Searchable category dropdown for MauDau portal_id mapping */
function CategoryPortalRow({
  catName, value, maudauCategories, onChange,
}: {
  catName: string
  value: string
  maudauCategories: { slug: string; title: string }[]
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const selectedCat = maudauCategories.find(c => c.slug === value)
  const displayLabel = selectedCat ? selectedCat.title : value || '— оберіть —'

  const filtered = search.trim()
    ? maudauCategories.filter(c =>
        c.title.toLowerCase().includes(search.toLowerCase()) ||
        c.slug.toLowerCase().includes(search.toLowerCase())
      )
    : maudauCategories

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-zinc-300 flex-1 min-w-0 truncate">{catName}</span>
      <span className="text-zinc-600 text-xs shrink-0">→</span>

      <div className="relative w-48">
        <button
          type="button"
          onClick={() => { setOpen(o => !o); setSearch('') }}
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-left text-white focus:outline-none focus:border-purple-500 flex items-center justify-between gap-1"
        >
          <span className="truncate flex-1">{displayLabel}</span>
          <span className="text-zinc-500 shrink-0">{open ? '▲' : '▼'}</span>
        </button>

        {open && (
          <div className="absolute z-50 top-full left-0 mt-1 w-64 bg-zinc-900 border border-zinc-700 rounded shadow-xl">
            {/* Search input */}
            <div className="p-1.5 border-b border-zinc-700">
              <input
                autoFocus
                type="text"
                placeholder="Пошук категорії…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-purple-500"
              />
            </div>

            {/* Options list */}
            <ul className="max-h-48 overflow-y-auto">
              <li>
                <button
                  type="button"
                  className="w-full text-left px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-700"
                  onClick={() => { onChange(''); setOpen(false) }}
                >
                  — оберіть —
                </button>
              </li>
              {filtered.length === 0 && (
                <li className="px-2 py-2 text-xs text-zinc-500 text-center">Нічого не знайдено</li>
              )}
              {filtered.map(mc => (
                <li key={mc.slug}>
                  <button
                    type="button"
                    onClick={() => { onChange(mc.slug); setOpen(false); setSearch('') }}
                    className={`w-full text-left px-2 py-1 text-xs hover:bg-zinc-700 ${
                      mc.slug === value ? 'text-purple-400 bg-zinc-800' : 'text-white'
                    }`}
                  >
                    {mc.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
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
  const [syncingCats, setSyncingCats] = useState(false)
  const [syncCatsMsg, setSyncCatsMsg] = useState('')
  const [syncingWC, setSyncingWC] = useState(false)
  const [syncWCMsg, setSyncWCMsg] = useState('')

  const handleSyncWC = async () => {
    setSyncingWC(true)
    setSyncWCMsg('')
    try {
      const res = await fetch('/api/sync/woocommerce', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'manual', trigger: 'feed-editor' }) })
      const data = await res.json()
      setSyncWCMsg(data.success ? `✓ Синхронізовано: ${data.created ?? 0} нових, ${data.updated ?? 0} оновлено` : `Помилка: ${data.error ?? 'невідома'}`)
    } catch {
      setSyncWCMsg('Помилка підключення')
    } finally {
      setSyncingWC(false)
    }
  }

  const handleSyncAllCategories = async () => {
    setSyncingCats(true)
    setSyncCatsMsg('')
    try {
      const res = await fetch('/api/maudau/sync-categories', { method: 'POST' })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)
      setSyncCatsMsg(`✅ Синхронізовано ${data.count} категорій`)
      loadMaudauCategories()
    } catch (err: any) {
      setSyncCatsMsg('❌ ' + (err.message ?? 'Помилка'))
    } finally {
      setSyncingCats(false)
    }
  }

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
      custom_params: fp.custom_params ?? {},
    }]))
  )

  const [translating, setTranslating] = useState<Record<string, boolean>>({})

  async function translateField(productId: string, field: 'name_ru' | 'description_ru', sourceText: string) {
    if (!sourceText.trim()) return
    setTranslating(t => ({ ...t, [`${productId}:${field}`]: true }))
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: sourceText }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        console.error('translate failed:', err?.error ?? res.status)
        return
      }
      const data = await res.json()
      if (data.translation) setOverride(productId, field, data.translation)
    } catch (e) {
      console.error('translate error:', e)
    } finally {
      setTranslating(t => ({ ...t, [`${productId}:${field}`]: false }))
    }
  }

  const [productSearch, setProductSearch] = useState('')
  const [categorySearch, setCategorySearch] = useState('')
  const [showOnlySelected, setShowOnlySelected] = useState(false)
  // Which product row is expanded
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null)

  // Auto-translate name_ru when a row expands and field is empty
  useEffect(() => {
    if (!expandedProduct || !isMaudau) return
    const ov = overrides[expandedProduct] ?? {}
    if (!ov.name_ru?.trim()) {
      const product = allProducts.find(p => p.id === expandedProduct)
      if (product) translateField(expandedProduct, 'name_ru', product.name)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedProduct])

  const [bulkTranslating, setBulkTranslating] = useState(false)

  async function translateAllEmpty() {
    if (bulkTranslating) return
    setBulkTranslating(true)
    const toTranslate = filteredProducts.filter(p => {
      const ov = overrides[p.id] ?? {}
      return ov.is_active && !ov.name_ru?.trim()
    })
    for (const p of toTranslate) {
      await translateField(p.id, 'name_ru', p.name)
    }
    setBulkTranslating(false)
  }

  // Bulk param add
  const [bulkKey, setBulkKey] = useState('')
  const [bulkValue, setBulkValue] = useState('')

  const applyBulkParam = () => {
    const key = bulkKey.trim()
    const value = bulkValue.trim()
    if (!key || !value) return
    setOverrides(prev => {
      const next = { ...prev }
      filteredProducts.forEach(p => {
        if (next[p.id]?.is_active !== true) return
        next[p.id] = { ...next[p.id], custom_params: { ...(next[p.id]?.custom_params ?? {}), [key]: value } }
      })
      return next
    })
  }

  const autoFillParams = () => {
    setOverrides(prev => {
      const next = { ...prev }
      allProducts.forEach(p => {
        if (next[p.id]?.is_active !== true) return
        const existing = { ...(next[p.id]?.custom_params ?? {}) }

        // Normalize: merge "Країна виробника" → "Країна виробник"
        if (existing['Країна виробника'] && !existing['Країна виробник']) {
          existing['Країна виробник'] = existing['Країна виробника']
        }
        delete existing['Країна виробника']

        const auto: Record<string, string> = {}

        const attrs = p.attributes ?? {}
        const minVal  = parseFloat(attrs['Мін']  ?? '0') || null
        const unit    = attrs['Одиниця'] ?? 'шт'
        const weightFromName = attrs['Вага']

        // Вага упаковки
        if (!existing['Вага упаковки']) {
          const isWeightUnit = ['кг', 'г', 'мл', 'л'].includes(unit)
          if (isWeightUnit && minVal) {
            auto['Вага упаковки'] = `${minVal} ${unit}`
          } else if (weightFromName) {
            auto['Вага упаковки'] = weightFromName
          }
        }

        // Торгова марка
        if (!existing['Торгова марка'] && p.brand) auto['Торгова марка'] = p.brand

        // Країна виробник
        if (!existing['Країна виробник']) auto['Країна виробник'] = 'Україна'

        // Гарантія
        if (!existing['Гарантія']) auto['Гарантія'] = 'Термін придатності вказаний на упаковці'

        if (Object.keys(auto).length > 0 || JSON.stringify(existing) !== JSON.stringify(next[p.id]?.custom_params ?? {})) {
          next[p.id] = { ...next[p.id], custom_params: { ...auto, ...existing } }
        }
      })
      return next
    })
  }

  // Categories filtered by search
  const filteredCategories = useMemo(() =>
    categories.filter(c => !categorySearch || c.toLowerCase().includes(categorySearch.toLowerCase())),
    [categories, categorySearch]
  )

  // Filtered products list based on category filter setting
  const filteredProducts = useMemo(() => allProducts.filter(p => {
    if (showOnlySelected && overrides[p.id]?.is_active !== true) return false
    if (selectedCategories.length > 0) {
      if (!p.category_name || !selectedCategories.includes(p.category_name)) return false
    }
    if (productSearch) {
      return p.name.toLowerCase().includes(productSearch.toLowerCase())
    }
    return true
  }), [allProducts, selectedCategories, productSearch, showOnlySelected, overrides])

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

  const setOverride = (productId: string, field: keyof Override, value: string | boolean | Record<string, string>) => {
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

  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    if (!confirm(`Видалити фід "${feed.name}"? Цю дію не можна скасувати.`)) return
    setDeleting(true)
    try {
      const res = await fetch('/api/feeds/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: feed.id }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)
      router.push('/feeds')
    } catch (err: any) {
      alert('Помилка видалення: ' + err.message)
      setDeleting(false)
    }
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
        <div className="flex gap-3 items-center">
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="px-3 py-2 bg-zinc-900 hover:bg-red-950 border border-zinc-700 hover:border-red-700 text-zinc-500 hover:text-red-400 text-sm rounded-lg transition-colors disabled:opacity-50"
            title="Видалити фід"
          >
            {deleting ? '⏳' : '🗑 Видалити'}
          </button>
          <div className="w-px h-6 bg-zinc-800" />
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={handleSyncWC}
              disabled={syncingWC}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-sm rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1.5"
              title="Синхронізувати товари з WooCommerce"
            >
              <span className={syncingWC ? 'animate-spin inline-block' : ''}>↻</span>
              {syncingWC ? 'Синхронізація...' : 'Синк з WC'}
            </button>
            {syncWCMsg && <span className="text-[11px] text-zinc-400">{syncWCMsg}</span>}
          </div>
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


          {/* MauDau: Category portal_id mapping */}
          {isMaudau && (
            <div className="bg-zinc-900 border border-purple-900/50 rounded-xl p-5">
              <div className="flex items-start justify-between gap-2 mb-1">
                <h2 className="text-sm font-semibold text-white">🟣 MauDau — категорії</h2>
                {maudauCatsLoading && <span className="text-xs text-zinc-500">Завантаження...</span>}
              </div>
              <p className="text-xs text-zinc-500 mb-3">
                Зіставте свої категорії з категоріями MauDau.
                {maudauCategories.length > 0 && (
                  <span className={maudauCatsSource === 'db' ? 'text-emerald-500' : 'text-amber-500'}>
                    {' '}• {maudauCategories.length} категорій
                  </span>
                )}
              </p>

              {/* Sync all categories button */}
              <div className="mb-4 flex items-center gap-3">
                <button
                  onClick={handleSyncAllCategories}
                  disabled={syncingCats}
                  className="text-xs px-3 py-1.5 rounded-lg border border-purple-700 text-purple-300 hover:bg-purple-900/20 transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  {syncingCats ? '⏳ Синхронізація...' : '🔄 Завантажити всі категорії MauDau'}
                </button>
                {syncCatsMsg && <span className="text-xs text-zinc-400">{syncCatsMsg}</span>}
                {syncingCats && <span className="text-xs text-zinc-500">~1-2 хв, зачекайте...</span>}
              </div>

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

          {/* Header: search + counters */}
          <div className="px-4 pt-4 pb-3 border-b border-zinc-800 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-white">Товари у фіді</h2>
                <div className="text-xs text-zinc-500 mt-0.5">
                  <span className="text-emerald-400 font-medium">{selectedCount}</span> вибрано
                  <span className="mx-1.5 text-zinc-700">·</span>
                  {filteredProducts.length !== allProducts.length
                    ? <><span className="text-white">{filteredProducts.length}</span> показано · {allProducts.length} всього</>
                    : <>{allProducts.length} всього</>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowOnlySelected(v => !v)}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition-colors whitespace-nowrap ${
                    showOnlySelected
                      ? 'bg-emerald-600 border-emerald-600 text-white'
                      : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-500'
                  }`}
                >
                  {showOnlySelected ? '✓ Вибрані' : 'Вибрані'}
                </button>
                <input
                  type="text"
                  placeholder="🔍 Пошук..."
                  value={productSearch}
                  onChange={e => setProductSearch(e.target.value)}
                  className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-red-500 w-36"
                />
                {isMaudau && (
                  <button
                    onClick={translateAllEmpty}
                    disabled={bulkTranslating}
                    className="text-xs px-3 py-1.5 rounded-lg border border-purple-800 text-purple-300 hover:bg-purple-900/20 transition-colors disabled:opacity-50 whitespace-nowrap"
                  >
                    {bulkTranslating ? '⏳ Перекладаю...' : '🔄 Перекласти всі'}
                  </button>
                )}
              </div>
            </div>

            {/* Category filter */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs text-zinc-500">🗂 Категорія:</span>
                {selectedCategories.length > 0 && (
                  <button
                    onClick={() => setSelectedCategories([])}
                    className="text-xs text-zinc-500 hover:text-red-400 transition-colors"
                  >✕ скинути</button>
                )}
              </div>
              <input
                type="text"
                placeholder="Пошук категорії..."
                value={categorySearch}
                onChange={e => setCategorySearch(e.target.value)}
                className="w-full mb-2 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-red-500"
              />
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                {filteredCategories.map(cat => (
                  <button
                    key={cat}
                    onClick={() => toggleCategory(cat)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors whitespace-nowrap ${
                      selectedCategories.includes(cat)
                        ? 'bg-red-600 border-red-600 text-white'
                        : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-500'
                    }`}
                  >{cat}</button>
                ))}
                {filteredCategories.length === 0 && (
                  <span className="text-xs text-zinc-600">Нічого не знайдено</span>
                )}
              </div>
            </div>

            {/* Bulk actions */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={selectAllVisible}
                className="text-xs px-3 py-1.5 bg-emerald-900/40 hover:bg-emerald-900/60 border border-emerald-800 text-emerald-400 rounded-lg transition-colors"
              >✓ Вибрати видимі ({filteredProducts.length})</button>
              <button
                onClick={deselectAllVisible}
                className="text-xs px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-400 rounded-lg transition-colors"
              >✕ Зняти видимі</button>
              <div className="w-px h-4 bg-zinc-700 mx-1" />
              <button
                onClick={autoFillParams}
                title="Автоматично заповнює: Вага упаковки, Країна виробник, Торгова марка, Гарантія — тільки для активних товарів, не перезаписує вже заповнені. Також видаляє дублікат 'Країна виробника'."
                className="text-xs px-3 py-1.5 bg-amber-900/40 hover:bg-amber-900/60 border border-amber-800 text-amber-400 rounded-lg transition-colors whitespace-nowrap"
              >✦ Автозаповнення</button>
            </div>

            {/* Bulk param add */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-zinc-500 shrink-0">Масово:</span>
              <input
                type="text"
                placeholder="Назва (напр. Тип)"
                value={bulkKey}
                onChange={e => setBulkKey(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 w-32"
              />
              <span className="text-zinc-600 text-xs">:</span>
              <input
                type="text"
                placeholder="Значення"
                value={bulkValue}
                onChange={e => setBulkValue(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 flex-1"
              />
              <button
                onClick={applyBulkParam}
                disabled={!bulkKey.trim() || !bulkValue.trim()}
                className="text-xs px-3 py-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded transition-colors disabled:opacity-40 whitespace-nowrap"
              >→ Всім вибраним</button>
            </div>
          </div>

          {/* Column headers */}
          <div className="grid grid-cols-[20px_36px_1fr_70px_70px_56px] gap-2 px-4 py-2 bg-zinc-800/50 border-b border-zinc-800">
            <div className="text-xs text-zinc-600">✓</div>
            <div />
            <div className="text-xs text-zinc-600 uppercase tracking-wide">Товар</div>
            <div className="text-xs text-zinc-600 uppercase tracking-wide text-right">Ціна</div>
            <div className="text-xs text-zinc-600 uppercase tracking-wide text-right">Акційна</div>
            <div className="text-xs text-zinc-600 uppercase tracking-wide text-right">Залишок</div>
          </div>

          <div className="overflow-y-auto flex-1 max-h-[560px] divide-y divide-zinc-800/60">
            {filteredProducts.length === 0 && (
              <div className="py-12 text-center text-zinc-600 text-sm">Немає товарів</div>
            )}
            {filteredProducts.slice(0, 500).map(p => {
              const ov = overrides[p.id] ?? {}
              const isActive = ov.is_active === true
              const isExpanded = expandedProduct === p.id
              const thumb = p.images?.[0]
              const paramCount = Object.keys(ov.custom_params ?? {}).length
              const fewParams = isActive && paramCount < 3
              const stock = ov.custom_stock !== '' && ov.custom_stock != null
                ? Number(ov.custom_stock)
                : p.stock

              return (
                <div key={p.id} className={`transition-colors ${isActive ? 'hover:bg-zinc-800/30' : 'opacity-35 hover:opacity-60'}`}>
                  <div className="grid grid-cols-[20px_36px_1fr_70px_70px_56px] gap-2 px-4 py-2 items-center">
                    {/* Checkbox */}
                    <input
                      type="checkbox"
                      checked={isActive}
                      onChange={e => setOverride(p.id, 'is_active', e.target.checked)}
                      className="accent-red-500 cursor-pointer"
                    />

                    {/* Thumbnail */}
                    <div className="w-8 h-8 rounded overflow-hidden bg-zinc-800 shrink-0 flex items-center justify-center">
                      {thumb
                        ? <img src={thumb} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                        : <span className="text-zinc-700 text-[10px]">—</span>}
                    </div>

                    {/* Name + category */}
                    <div className="min-w-0">
                      <button
                        onClick={() => setExpandedProduct(isExpanded ? null : p.id)}
                        className="text-left w-full cursor-pointer"
                      >
                        <div className="text-xs text-white font-medium leading-snug line-clamp-2 flex items-start gap-1">
                          <span className="text-zinc-600 shrink-0 mt-px">{isExpanded ? '▾' : '▸'}</span>
                          <span>{p.name}</span>
                          {fewParams && (
                            <span title={`Лише ${paramCount} характеристик (потрібно мін. 3)`} className="shrink-0 ml-1 text-[9px] px-1 py-px rounded bg-amber-900/60 text-amber-400 border border-amber-800/50 leading-tight mt-px">
                              {paramCount}/3
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-zinc-500 mt-0.5 truncate">{p.category_name}</div>
                      </button>
                    </div>

                    {/* Price */}
                    <div>
                      <input
                        type="number"
                        placeholder={String(p.price ?? '')}
                        value={ov.custom_price ?? ''}
                        onChange={e => setOverride(p.id, 'custom_price', e.target.value)}
                        className="w-full bg-zinc-800 border border-zinc-700 rounded px-1.5 py-1 text-xs text-white text-right focus:outline-none focus:border-amber-500 placeholder:text-zinc-500"
                      />
                    </div>

                    {/* Sale price (price_old = original, price = discounted) */}
                    <div className="text-right">
                      {p.price_old != null ? (
                        <div>
                          <div className="text-xs text-emerald-400 font-medium">{p.price} ₴</div>
                          <div className="text-[10px] text-zinc-500 line-through">{p.price_old} ₴</div>
                        </div>
                      ) : (
                        <span className="text-xs text-zinc-600">—</span>
                      )}
                    </div>

                    {/* Stock */}
                    <div className="text-right">
                      {stock == null
                        ? <span className="text-xs text-zinc-600">∞</span>
                        : <span className={`text-xs font-medium ${stock > 0 ? 'text-emerald-400' : 'text-red-400'}`}>{stock}</span>}
                    </div>
                  </div>

                  {/* Expanded: characteristics + MauDau fields */}
                  {isExpanded && (
                    <div className="px-4 pb-3 space-y-3 bg-zinc-800/20 border-t border-zinc-800/60">
                      {/* Custom params (all feeds) */}
                      <div className="pt-2">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[11px] text-zinc-400 font-medium">Характеристики</span>
                          <button
                            type="button"
                            onClick={() => {
                              const params = { ...(ov.custom_params ?? {}) }
                              const key = `Параметр ${Object.keys(params).length + 1}`
                              params[key] = ''
                              setOverride(p.id, 'custom_params', params)
                            }}
                            className="text-[10px] px-2 py-0.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded transition-colors"
                          >+ Додати</button>
                        </div>
                        {Object.keys(ov.custom_params ?? {}).length === 0 ? (
                          <p className="text-[11px] text-zinc-600">Немає характеристик. Натисніть "+ Додати".</p>
                        ) : (
                          <div className="space-y-1.5">
                            {Object.entries(ov.custom_params ?? {}).map(([key, val]) => (
                              <div key={key} className="flex items-center gap-1.5">
                                <input
                                  type="text"
                                  defaultValue={key}
                                  onBlur={e => {
                                    const newKey = e.target.value.trim()
                                    if (!newKey || newKey === key) return
                                    const params = { ...(ov.custom_params ?? {}) }
                                    const value = params[key]
                                    delete params[key]
                                    params[newKey] = value
                                    setOverride(p.id, 'custom_params', params)
                                  }}
                                  className="w-32 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-1 text-[11px] text-zinc-300 focus:outline-none focus:border-zinc-500"
                                  placeholder="Назва"
                                />
                                <span className="text-zinc-600 text-xs">:</span>
                                <input
                                  type="text"
                                  value={val}
                                  onChange={e => {
                                    const params = { ...(ov.custom_params ?? {}), [key]: e.target.value }
                                    setOverride(p.id, 'custom_params', params)
                                  }}
                                  className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-1 text-[11px] text-white focus:outline-none focus:border-zinc-500"
                                  placeholder="Значення"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    const params = { ...(ov.custom_params ?? {}) }
                                    delete params[key]
                                    setOverride(p.id, 'custom_params', params)
                                  }}
                                  className="text-zinc-600 hover:text-red-400 text-xs px-1 transition-colors"
                                >✕</button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* MauDau-only: name_ru + description_ru */}
                      {isMaudau && (
                        <div className="space-y-2 border-t border-zinc-800/60 pt-2">
                          <p className="text-[11px] text-zinc-600">Назва та опис рос. мовою (необов'язково)</p>
                          <div>
                            <div className="flex items-center justify-between mb-0.5">
                              <label className="text-[11px] text-zinc-500">name_ru</label>
                              <button
                                type="button"
                                disabled={translating[`${p.id}:name_ru`]}
                                onClick={() => translateField(p.id, 'name_ru', p.name)}
                                className="text-[10px] text-purple-400 hover:text-purple-300 disabled:opacity-40 transition-colors"
                              >
                                {translating[`${p.id}:name_ru`] ? '⏳' : '🔄 Перекласти'}
                              </button>
                            </div>
                            <input
                              type="text"
                              placeholder={p.name}
                              value={ov.name_ru ?? ''}
                              onChange={e => setOverride(p.id, 'name_ru', e.target.value)}
                              className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-purple-500 placeholder:text-zinc-600"
                            />
                          </div>
                          <div>
                            <div className="flex items-center justify-between mb-0.5">
                              <label className="text-[11px] text-zinc-500">description_ru</label>
                              <button
                                type="button"
                                disabled={translating[`${p.id}:description_ru`] || !ov.description_ru?.trim()}
                                onClick={() => translateField(p.id, 'description_ru', ov.description_ru ?? '')}
                                className="text-[10px] text-purple-400 hover:text-purple-300 disabled:opacity-40 transition-colors"
                              >
                                {translating[`${p.id}:description_ru`] ? '⏳' : '🔄 Перекласти'}
                              </button>
                            </div>
                            <textarea
                              rows={2}
                              placeholder="Опис рос. мовою..."
                              value={ov.description_ru ?? ''}
                              onChange={e => setOverride(p.id, 'description_ru', e.target.value)}
                              className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-purple-500 placeholder:text-zinc-600 resize-none"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {filteredProducts.length > 500 && (
            <div className="px-4 py-2 border-t border-zinc-800 text-xs text-zinc-600 text-center">
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

      {/* Access stats */}
      <FeedAccessStats feedId={feed.id} />
    </div>
  )
}

function FeedAccessStats({ feedId }: { feedId: string }) {
  const [logs, setLogs] = useState<{ accessed_at: string; offers_count: number | null; errors_count: number | null; auto_synced: boolean }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/feeds/${feedId}/access-logs`)
      .then(r => r.json())
      .then(d => setLogs(d.logs ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [feedId])

  if (loading) return null
  if (logs.length === 0) return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
      <h2 className="text-sm font-semibold text-white mb-1">📊 Статистика звернень</h2>
      <p className="text-xs text-zinc-600">Фід ще не відкривався</p>
    </div>
  )

  const now = Date.now()
  const day = 24 * 60 * 60 * 1000
  const countDay = logs.filter(l => now - new Date(l.accessed_at).getTime() < day).length
  const countWeek = logs.length
  const totalErrors = logs.reduce((s, l) => s + (l.errors_count ?? 0), 0)

  const pad = (n: number) => String(n).padStart(2, '0')
  const fmt = (d: string) => {
    const dt = new Date(d)
    return `${pad(dt.getDate())}.${pad(dt.getMonth() + 1)} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
      <h2 className="text-sm font-semibold text-white mb-4">📊 Статистика звернень</h2>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        <div className="bg-zinc-800 rounded-lg p-3 text-center">
          <div className="text-xl font-bold text-white">{countDay}</div>
          <div className="text-xs text-zinc-500 mt-0.5">за 24 год</div>
        </div>
        <div className="bg-zinc-800 rounded-lg p-3 text-center">
          <div className="text-xl font-bold text-white">{countWeek}</div>
          <div className="text-xs text-zinc-500 mt-0.5">за 7 днів</div>
        </div>
        <div className="bg-zinc-800 rounded-lg p-3 text-center">
          <div className={`text-xl font-bold ${totalErrors > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
            {totalErrors > 0 ? totalErrors : '0'}
          </div>
          <div className="text-xs text-zinc-500 mt-0.5">помилок</div>
        </div>
      </div>

      {/* Recent log */}
      <div className="text-xs text-zinc-500 mb-2">Останні 10 звернень</div>
      <div className="space-y-1">
        {logs.slice(0, 10).map((l, i) => (
          <div key={i} className="flex items-center gap-3 text-xs py-1 border-b border-zinc-800 last:border-0">
            <span className="font-mono text-zinc-400 w-28 shrink-0">{fmt(l.accessed_at)}</span>
            <span className="text-zinc-300">{l.offers_count ?? '?'} товарів</span>
            {(l.errors_count ?? 0) > 0 && (
              <span className="text-red-400">⚠ {l.errors_count} помилок</span>
            )}
            {l.auto_synced && (
              <span className="text-emerald-500 ml-auto">🔄 WC синк</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

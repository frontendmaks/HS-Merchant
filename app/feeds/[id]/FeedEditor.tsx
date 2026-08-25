'use client'
import { useState, useTransition, useMemo, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'

type Product = {
  id: string
  name: string
  description: string | null
  category_name: string | null
  categories: string[] | null
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
  custom_name?: string
  is_active?: boolean
  name_ru?: string
  description_ru?: string
  custom_params?: Record<string, string>
}

// Header and rows of the feed products table share one track list so they stay
// aligned. The table is too dense to reflow onto a phone; it scrolls sideways
// inside its card instead, so the columns look identical at every screen size.
const FEED_COLS = '20px 10px 36px 1fr 36px 48px 48px 70px 70px 52px 86px 86px'
const FEED_MIN_W = 'min-w-[950px]'

/** Floating searchable select — renders panel via portal so it's never clipped by overflow containers */
function SearchableSelect({
  value, options, onChange, placeholder = '— Обрати —', emptyLabel, isEmpty, accentColor = 'zinc',
}: {
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
  placeholder?: string
  emptyLabel?: string
  isEmpty?: boolean
  accentColor?: 'zinc' | 'purple' | 'amber'
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({})
  const triggerRef = useRef<HTMLButtonElement>(null)

  const selectedLabel = options.find(o => o.value === value)?.label ?? ''

  const filtered = search.trim()
    ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : options

  const openPanel = () => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const panelH = Math.min(300, filtered.length * 28 + 56)
    const showAbove = spaceBelow < panelH && rect.top > panelH
    setPanelStyle({
      position: 'fixed',
      left: rect.left,
      width: Math.max(rect.width, 220),
      zIndex: 9999,
      ...(showAbove ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
    })
    setSearch('')
    setOpen(true)
  }

  const borderClass = isEmpty
    ? 'border-amber-600 hover:border-amber-400'
    : accentColor === 'purple'
      ? 'border-zinc-700 hover:border-purple-500'
      : 'border-zinc-700 hover:border-zinc-500'

  const bgClass = isEmpty ? 'bg-amber-950/30' : 'bg-zinc-800'
  const textClass = isEmpty ? 'text-amber-200' : 'text-zinc-200'

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openPanel}
        className={`w-full flex items-center justify-between gap-1 rounded px-2 py-1 text-[11px] text-left focus:outline-none transition-colors ${bgClass} border ${borderClass} ${textClass}`}
      >
        <span className="truncate flex-1">{selectedLabel || <span className="text-zinc-500">{placeholder}</span>}</span>
        <span className="text-zinc-500 shrink-0 text-[9px]">▼</span>
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <>
          <div className="fixed inset-0" style={{ zIndex: 9998 }} onClick={() => setOpen(false)} />
          <div
            className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden flex flex-col"
            style={{ ...panelStyle, maxHeight: 300 }}
          >
            <div className="p-1.5 border-b border-zinc-800 shrink-0">
              <input
                autoFocus
                type="text"
                placeholder="Пошук..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-zinc-500"
              />
            </div>
            <ul className="overflow-y-auto flex-1">
              {emptyLabel && (
                <li>
                  <button type="button"
                    className="w-full text-left px-2 py-1.5 text-[11px] text-zinc-500 hover:bg-zinc-800 transition-colors"
                    onClick={() => { onChange(''); setOpen(false) }}
                  >{emptyLabel}</button>
                </li>
              )}
              {filtered.length === 0 && (
                <li className="px-2 py-3 text-xs text-zinc-600 text-center">Нічого не знайдено</li>
              )}
              {filtered.map((o, i) => (
                <li key={i}>
                  <button type="button"
                    onClick={() => { onChange(o.value); setOpen(false) }}
                    className={`w-full text-left px-2 py-1.5 text-[11px] hover:bg-zinc-800 transition-colors ${
                      o.value === value
                        ? accentColor === 'purple' ? 'text-purple-400 font-medium' : 'text-emerald-400 font-medium'
                        : 'text-zinc-200'
                    }`}
                  >{o.label}</button>
                </li>
              ))}
            </ul>
          </div>
        </>,
        document.body
      )}
    </>
  )
}

/** MauDau category picker — uses SearchableSelect */
function MauDauCatDropdown({
  value, maudauCategories, onChange,
}: {
  value: string
  maudauCategories: { slug: string; title: string; portal_id?: string }[]
  onChange: (v: string) => void
}) {
  const options = maudauCategories.map(c => ({ value: c.slug, label: c.title }))
  return (
    <SearchableSelect
      value={value}
      options={options}
      onChange={onChange}
      placeholder="— оберіть —"
      emptyLabel="— прибрати вибір —"
      accentColor="purple"
    />
  )
}

interface RzCategory {
  id: number
  title: string
  level: number | null
  is_vendor_required: boolean
}

interface RzAttribute {
  id: number
  title: string
  type: string
  unit: string | null
  values: { id: number; value: string }[]
}

/** Rozetka category picker. Same control as MauDau's, but over 4700 entries
 *  rather than 139, so the level is shown to tell near-identical names apart. */
function RozetkaCatDropdown({ value, categories, onChange }: {
  value: string
  categories: RzCategory[]
  onChange: (v: string) => void
}) {
  const options = useMemo(
    () => categories.map(c => ({ value: String(c.id), label: `${c.title} · ${c.id}` })),
    [categories],
  )
  return (
    <SearchableSelect
      value={value}
      options={options}
      onChange={onChange}
      placeholder="— оберіть —"
      emptyLabel="— прибрати вибір —"
      accentColor="purple"
    />
  )
}

export default function FeedEditor({ feed, feedProducts, allProducts, categories, marketplaces }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)

  const isMaudau = feed.marketplace?.slug === 'maudau' || feed.marketplace?.name?.toLowerCase().includes('maudau')
  const isRozetka = feed.marketplace?.slug === 'rozetka' || feed.marketplace?.name?.toLowerCase().includes('rozetka')

  // Rozetka: its whole tree, held client-side so the picker can filter without
  // a round trip. ~4700 entries, id and title only.
  const [rzCategories, setRzCategories] = useState<RzCategory[]>([])
  const [rzCatsLoading, setRzCatsLoading] = useState(false)
  const [rzCatsError, setRzCatsError] = useState('')
  const [rzSyncing, setRzSyncing] = useState(false)
  const [rzSyncMsg, setRzSyncMsg] = useState('')
  const [rzBlockSearch, setRzBlockSearch] = useState('')
  const [rzExpandedCats, setRzExpandedCats] = useState<Set<string>>(new Set())
  // Attributes per Rozetka category id, fetched on demand
  const [rzAttrs, setRzAttrs] = useState<Record<string, RzAttribute[]>>({})
  const [rzAttrsLoading, setRzAttrsLoading] = useState<Record<string, boolean>>({})

  const loadRzCategories = () => {
    setRzCatsLoading(true)
    setRzCatsError('')
    fetch('/api/rozetka/categories')
      .then(r => r.json())
      .then(d => {
        setRzCategories(d.categories ?? [])
        if (d.error) setRzCatsError(d.error)
        else if (d.hint) setRzCatsError(d.hint)
      })
      .catch(() => setRzCatsError('Не вдалося завантажити категорії Rozetka'))
      .finally(() => setRzCatsLoading(false))
  }

  const syncRzCategories = async () => {
    setRzSyncing(true)
    setRzSyncMsg('')
    try {
      const res = await fetch('/api/rozetka/sync-categories', { method: 'POST' })
      const d = await res.json()
      if (!d.success) throw new Error(d.error)
      setRzSyncMsg(`✅ ${d.count} категорій`)
      loadRzCategories()
    } catch (err) {
      setRzSyncMsg('❌ ' + ((err as Error).message || 'Помилка'))
    } finally {
      setRzSyncing(false)
    }
  }

  /** Rozetka charges one request per attribute value list, so fetch a
   *  category's attributes once and keep them. */
  const loadRzAttrs = async (categoryId: string, force = false) => {
    if (!categoryId) return
    if (!force && rzAttrs[categoryId]) return
    setRzAttrsLoading(m => ({ ...m, [categoryId]: true }))
    try {
      const res = force
        ? await fetch('/api/rozetka/attributes', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ category_id: Number(categoryId) }),
          })
        : await fetch(`/api/rozetka/attributes?category_id=${categoryId}`)
      const d = await res.json()
      if (d.success) setRzAttrs(m => ({ ...m, [categoryId]: d.attributes ?? [] }))
    } finally {
      setRzAttrsLoading(m => ({ ...m, [categoryId]: false }))
    }
  }

  useEffect(() => {
    if (!isRozetka) return
    loadRzCategories()
  }, [isRozetka])

  // Categories mapped in an earlier session need their attributes back before
  // the editor can show what is already filled in
  useEffect(() => {
    if (!isRozetka) return
    for (const id of new Set(Object.values(rzCategoryIds).filter(Boolean))) void loadRzAttrs(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRozetka])

  // MauDau: available categories fetched from API / DB
  const [maudauCategories, setMaudauCategories] = useState<{ slug: string; title: string; portal_id?: string; attributes?: { name: string; type: string; values: string[] }[] }[]>([])
  const [maudauCatsLoading, setMaudauCatsLoading] = useState(false)
  const [maudauCatsError, setMaudauCatsError] = useState('')
  const [maudauCatsSource, setMaudauCatsSource] = useState<'db' | 'api' | ''>('')
  const [xlsxUploading, setXlsxUploading] = useState(false)
  const [xlsxMsg, setXlsxMsg] = useState('')
  const [charXlsxLoading, setCharXlsxLoading] = useState(false)
  const [charXlsxMsg, setCharXlsxMsg] = useState('')
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
  // Rozetka: category id per category name
  const [rzCategoryIds, setRzCategoryIds] = useState<Record<string, string>>(
    feed.settings?.rozetka_category_ids ?? {}
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

  // Stable snapshot of products saved in the feed (from DB, doesn't change until save)
  const savedFeedIds = useMemo(
    () => new Set(feedProducts.filter(fp => fp.is_active).map(fp => fp.product_id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [] // intentionally computed once from initial props
  )

  const [productSearch, setProductSearch] = useState('')
  const [categorySearch, setCategorySearch] = useState('')
  const [catBlockOpen, setCatBlockOpen] = useState(true)
  const [showOnlySelected, setShowOnlySelected] = useState(false)
  const [showOnlyWithIssues, setShowOnlyWithIssues] = useState(false)
  const [showOnlyInFeed, setShowOnlyInFeed] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const PAGE_SIZE = 50
  // Which product row is expanded
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null)
  // MauDau category block: expand per category + search + category-level defaults
  const [expandedCatBlocks, setExpandedCatBlocks] = useState<Set<string>>(new Set())
  const [maudauBlockSearch, setMaudauBlockSearch] = useState('')
  const [attrTemplateStatus, setAttrTemplateStatus] = useState<Record<string, string>>({}) // portalId → 'ok'|'err'|msg

  /** Writes one Rozetka attribute onto every active product of our category.
   *  Keys are prefixed so they cannot collide with a WooCommerce attribute of
   *  the same name, and so the generator knows which params are Rozetka's. */
  const rzParamKey = (attrId: number) => `_rz_${attrId}`

  const setRzCatDefault = (catName: string, attrId: number, value: string) => {
    setOverrides(prev => {
      const next = { ...prev }
      for (const p of allProducts) {
        if (p.category_name !== catName) continue
        if (next[p.id]?.is_active !== true) continue
        const params = { ...(next[p.id]?.custom_params ?? {}) }
        if (value) params[rzParamKey(attrId)] = value
        else delete params[rzParamKey(attrId)]
        next[p.id] = { ...next[p.id], custom_params: params }
      }
      return next
    })
  }

  const setCatDefaultAndApply = (catName: string, portalId: string, attrName: string, value: string) => {
    setOverrides(prev => {
      const next = { ...prev }
      allProducts.forEach(p => {
        const pPortalId = p.category_name === catName
          ? portalId
          : (overrides[p.id]?.custom_params?.['_maudau_category'] || '')
        if (p.category_name !== catName && pPortalId !== portalId) return
        if (p.category_name !== catName) return
        if (next[p.id]?.is_active !== true) return
        next[p.id] = {
          ...next[p.id],
          custom_params: { ...(next[p.id]?.custom_params ?? {}), [attrName]: value }
        }
      })
      return next
    })
  }

  // Auto-translate name_ru and description_ru when a row expands and fields are empty
  useEffect(() => {
    if (!expandedProduct || !isMaudau) return
    const ov = overrides[expandedProduct] ?? {}
    const product = allProducts.find(p => p.id === expandedProduct)
    if (!product) return
    if (!ov.name_ru?.trim()) {
      translateField(expandedProduct, 'name_ru', productFullName(product, ov.custom_name))
    }
    if (!ov.description_ru?.trim()) {
      const descSource = ov.custom_params?.['Опис']?.trim() || product.description?.trim()
      if (descSource) translateField(expandedProduct, 'description_ru', descSource)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedProduct])

  const [bulkTranslating, setBulkTranslating] = useState(false)

  async function translateAllEmpty() {
    if (bulkTranslating) return
    setBulkTranslating(true)
    try {
      // Translate all active products — re-translates existing values too (needed after weight suffix was added)
      const toTranslate = allProducts.filter(p => {
        const ov = overrides[p.id] ?? {}
        const fp = fpMap.get(p.id)
        const isActive = ov.is_active ?? fp?.is_active ?? false
        return isActive
      })
      for (const p of toTranslate) {
        const ov = overrides[p.id] ?? {}
        await translateField(p.id, 'name_ru', productFullName(p, ov.custom_name))
        const descSource = ov.custom_params?.['Опис']?.trim() || p.description?.trim()
        if (descSource) await translateField(p.id, 'description_ru', descSource)
      }
    } finally {
      setBulkTranslating(false)
    }
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

  // Marketplace price for weight products:
  // кг/л: price is per kg → multiply by min_kg (default 0.4 = 400g if no min)
  // г/мл: price is already per-portion → no change
  // other: null (piece product, no transformation)
  function calcMarketplacePrice(price: number, attrs: Record<string, string> | null): number | null {
    const unit = (attrs?.['Одиниця'] ?? '').toLowerCase()
    const minRaw = parseFloat(attrs?.['Мін'] ?? '0') || 0
    if (unit === 'кг' || unit === 'л') {
      const minKg = minRaw > 0 ? minRaw : 0.4
      return Math.round(price * minKg * 100) / 100
    }
    if (unit === 'г' || unit === 'мл') {
      return Math.round(price * 100) / 100
    }
    return null
  }

  function getMinWeightLabel(attrs: Record<string, string> | null): string | null {
    const unit = (attrs?.['Одиниця'] ?? '').toLowerCase()
    const minRaw = parseFloat(attrs?.['Мін'] ?? '0') || 0
    if (unit === 'кг' || unit === 'л') return `${minRaw > 0 ? Math.round(minRaw * 1000) : 400} г`
    if (unit === 'г' || unit === 'мл') return `${minRaw > 0 ? Math.round(minRaw) : 400} ${unit}`
    return null
  }

  function productFullName(product: { name: string; attributes: unknown }, customName?: string): string {
    const base = customName?.trim() || product.name
    const label = getMinWeightLabel(product.attributes as Record<string, string> | null)
    return label ? `${base}, ${label}` : base
  }

  // Strip HTML tags for display (e.g. MauDau Гарантія values have <p>...</p>)
  function stripHtml(s: string): string {
    return s.replace(/<[^>]+>/g, '').trim()
  }

  // Find the closest standard weight from MauDau's allowed list
  function closestWeight(rawWeight: string, allowedValues: string[]): string {
    if (!allowedValues.length) return rawWeight
    // Check range buckets like "До 50 г", "101 г - 300 г", "Понад 500 г"
    const isRangeBucket = allowedValues.some(v => /до |понад |- /i.test(v))
    if (isRangeBucket) {
      const grams = parseGrams(rawWeight)
      if (grams == null) return ''
      for (const v of allowedValues) {
        if (/^до\s/i.test(v)) {
          const max = parseGrams(v.replace(/^до\s/i, ''))
          if (max != null && grams <= max) return v
        } else if (/^понад\s/i.test(v)) {
          const min = parseGrams(v.replace(/^понад\s/i, ''))
          if (min != null && grams > min) return v
        } else {
          const parts = v.split(/\s*-\s*/)
          if (parts.length === 2) {
            const lo = parseGrams(parts[0]), hi = parseGrams(parts[1])
            if (lo != null && hi != null && grams >= lo && grams <= hi) return v
          }
        }
      }
      return ''
    }
    // Exact numeric weights — find closest
    const grams = parseGrams(rawWeight)
    if (grams == null) return ''
    let best = '', bestDiff = Infinity
    for (const v of allowedValues) {
      const vg = parseGrams(v)
      if (vg == null) continue
      const diff = Math.abs(vg - grams)
      if (diff < bestDiff) { bestDiff = diff; best = v }
    }
    return bestDiff < grams * 0.3 ? best : '' // only use if within 30%
  }

  function parseGrams(s: string): number | null {
    const m = s.match(/([\d.,]+)\s*(кг|г|мл|л)/i)
    if (!m) return null
    const n = parseFloat(m[1].replace(',', '.'))
    const u = m[2].toLowerCase()
    if (u === 'кг' || u === 'л') return n * 1000
    return n
  }

  // ── MauDau smart inference ──────────────────────────────────────────────

  // Infer type only for meat/seafood products (by exact word boundaries)
  // allowedValues: список допустимих значень з MauDau категорії — тільки вони будуть повернуті
  function inferType(name: string, allowedValues: string[] = []): string | null {
    const n = name.toLowerCase()
    const allowed = new Set(allowedValues)
    const pick = (v: string) => (!allowed.size || allowed.has(v)) ? v : null

    // Ковбаси types
    if (/сирокопчен/.test(n)) return pick('Сирокопчена')
    if (/сиров.ял/.test(n)) return pick("Сиров'ялена")
    if (/варено-копчен/.test(n)) return pick('Варено-копчена')
    if (/напівкопчен/.test(n)) return pick('Напівкопчена')
    if (/\bкопчен/.test(n)) return pick('Копчена')
    if (/\bварен/.test(n)) return pick('Варена')
    if (/смажен/.test(n)) return pick('Смажена')

    // М'ясні напівфабрикати types
    if (/\bстейк/.test(n)) return pick('Стейк')
    if (/биточк/.test(n)) return pick('Биточки')
    if (/фрикадел|мітбол/.test(n)) return pick('Фрикадельки') || pick('Мітболи')
    if (/тефтел/.test(n)) return pick('Тефтелі')
    if (/котлет/.test(n)) return pick('Котлети')
    if (/шашлик/.test(n)) return pick('Шашлик')
    if (/кебаб|люля/.test(n)) return pick('Кебаби')
    if (/\bпаштет/.test(n)) return pick('Паштети')
    if (/сосис|сарделк/.test(n)) return pick('Сосиски для гриля')
    if (/\bребр/.test(n)) return pick('Ребра')
    if (/фарш(?![а-яіїєьА-ЯІЇЄ])/.test(n)) return pick('Фарш')
    if (/нагетс/.test(n)) return pick('Нагетси')
    if (/крильц|крило/.test(n)) return pick('Крильця')
    if (/голінк|гомілк/.test(n)) return pick('Гомілки')
    if (/\bкаре\b/.test(n)) return pick('Каре')
    if (/щічк/.test(n)) return pick('Щічки')
    if (/біфстроганов/.test(n)) return pick('Біфстроганов')
    if (/нарізк/.test(n)) return pick("М'ясна нарізка")
    return null
  }

  // Сорт: Салямі, Пепероні, Чорізо тощо (для Ковбаси)
  function inferSort(name: string, allowedValues: string[]): string | null {
    if (!allowedValues.length) return null
    const n = name.toLowerCase()
    const allowed = new Set(allowedValues)
    if (/салям/.test(n) && allowed.has('Салямі')) return 'Салямі'
    if (/пепероні/.test(n) && allowed.has('Пепероні')) return 'Пепероні'
    if (/фует/.test(n) && allowed.has('Фует')) return 'Фует'
    if (/сальчичон/.test(n) && allowed.has('Сальчичон')) return 'Сальчичон'
    if (/чорізо/.test(n) && allowed.has('Чорізо')) return 'Чорізо'
    return null
  }

  // Добавки: multiselect, значення через кому
  function inferDobavky(name: string, allowedValues: string[]): string | null {
    if (!allowedValues.length) return null
    const n = name.toLowerCase()
    const allowed = new Set(allowedValues)
    const found: string[] = []
    if (/горіх/.test(n) && allowed.has('Горіхи')) found.push('Горіхи')
    if (/гриб/.test(n) && allowed.has('Гриби')) found.push('Гриби')
    if (/зелен/.test(n) && allowed.has('Зелень')) found.push('Зелень')
    if (/оливк/.test(n) && allowed.has('Оливки')) found.push('Оливки')
    if (/паприк/.test(n) && allowed.has('Паприка')) found.push('Паприка')
    if (/\bтрав/.test(n) && allowed.has('Трави')) found.push('Трави')
    if (/сир(?!окопч|ов.ял)/.test(n) && allowed.has('Сир')) found.push('Сир')
    if (/перц/.test(n) && allowed.has('Перець')) found.push('Перець')
    if (/інжир/.test(n) && allowed.has('Інжир')) found.push('Інжир')
    return found.length ? found.join(', ') : null
  }

  function inferBase(name: string, categories: string[]): string | null {
    const text = (name + ' ' + categories.join(' ')).toLowerCase()
    if (/ягнят|баранин/.test(text)) return 'Баранина'
    if (/кролик/.test(text)) return 'Кролик'
    if (/індич/.test(text)) return 'Індичка'
    if (/качк/.test(text)) return 'Качка'
    if (/курч|кур'яч|курк|курятин/.test(text)) return 'Курка'
    if (/(ялович|телят).*свин|свин.*(ялович|телят)/.test(text)) return 'Свинина та яловичина'
    if (/ялович|телятин|теляч/.test(text)) return 'Яловичина'
    if (/свинин|свин/.test(text)) return 'Свинина'
    return null
  }

  function inferCookingMethods(type: string | null, name: string): string | null {
    const grillTypes = new Set(['Стейк', 'Шашлик', 'Кебаб', 'Люля-кебаб', 'Відбивні', 'Карбонад', 'Сосиски для гриля', 'Котлети', 'Медальйони'])
    const panTypes = new Set(['Стейк', 'Котлети', 'Тефтелі', 'Фрикадельки', 'Відбивні', 'Шніцель', 'Медальйони', 'Сосиски для гриля', 'Філе', 'Грудка', 'Нагетси', 'Стрипси'])
    const ovenTypes = new Set(['Ребра', 'Рулет', 'Буженина', 'Гуляш', 'Котлети', 'Тефтелі', 'Рулька', 'Стегно', 'Крила', 'Гомілка', 'Карбонад', 'Нагетси'])
    const potTypes = new Set(['Гуляш', 'Ребра', 'Рулька', 'Стегно', 'Гомілка', 'Фарш'])
    if (!type) return null
    const methods: string[] = []
    if (grillTypes.has(type)) methods.push('На мангалі або грилі')
    if (panTypes.has(type)) methods.push('На сковорідці')
    if (ovenTypes.has(type)) methods.push('У духовці')
    if (potTypes.has(type)) methods.push('У каструлі')
    return methods.length ? methods.join(', ') : null
  }

  function inferProcessing(name: string, categories: string[]): string {
    const text = (name + ' ' + categories.join(' ')).toLowerCase()
    if (/замор/.test(text)) return 'Морожений'
    return 'Охолоджений'
  }

  // Infer country from WooCommerce categories array ("Власний імпорт з Іспанії" → "Іспанія")
  function inferCountry(cats: string[]): string {
    // Genitive → Nominative (Ukrainian grammar: "з Іспанії" → "Іспанія")
    const GENITIVE_MAP: Record<string, string> = {
      'Іспанії': 'Іспанія',
      'Італії': 'Італія',
      'Франції': 'Франція',
      'Польщі': 'Польща',
      'Греції': 'Греція',
      'Австрії': 'Австрія',
      'Угорщини': 'Угорщина',
      'Румунії': 'Румунія',
      'Болгарії': 'Болгарія',
      'Чехії': 'Чехія',
      'Словаччини': 'Словаччина',
      'Хорватії': 'Хорватія',
      'Сербії': 'Сербія',
      'Молдови': 'Молдова',
      'Грузії': 'Грузія',
      'Вірменії': 'Вірменія',
      'Азербайджану': 'Азербайджан',
      'Білорусі': 'Білорусь',
      'Литви': 'Литва',
      'Латвії': 'Латвія',
      'Естонії': 'Естонія',
      'Нідерландів': 'Нідерланди',
      'Бельгії': 'Бельгія',
      'Швейцарії': 'Швейцарія',
      'Португалії': 'Португалія',
      'Данії': 'Данія',
      'Швеції': 'Швеція',
      'Фінляндії': 'Фінляндія',
      'Норвегії': 'Норвегія',
      'Туреччини': 'Туреччина',
      'Ізраїлю': 'Ізраїль',
      'України': 'Україна',
      'Німеччини': 'Німеччина',
    }
    for (const cat of cats) {
      const m = cat.match(/Власний імпорт з (.+)/i)
      if (m) {
        const gen = m[1].trim()
        return GENITIVE_MAP[gen] ?? gen
      }
    }
    return 'Україна'
  }

  // Slug → portalId resolver using maudauCategories (client-side)
  const slugToPortalIdClient = useMemo(() => {
    const map: Record<string, string> = {}
    for (const cat of maudauCategories) {
      if ((cat as any).slug && (cat as any).portal_id) map[(cat as any).slug] = (cat as any).portal_id
    }
    return map
  }, [maudauCategories])

  function getCatPortalId(wcCategoryName: string): string {
    const raw = categoryPortalIds[wcCategoryName] ?? ''
    if (!raw) return ''
    if (/^\d+$/.test(raw)) return raw
    return slugToPortalIdClient[raw] ?? ''
  }
  // ────────────────────────────────────────────────────────────────────────

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

        // Get MauDau attributes for this product's category
        const portalId = getCatPortalId(p.category_name ?? '')
        const catAttrs = portalId ? (portalIdAttrsMap[portalId] ?? []) : []
        const hasAttr = (name: string) => catAttrs.some(a => a.name === name)

        const attrs = p.attributes ?? {}
        const minVal = parseFloat(attrs['Мін'] ?? '0') || null
        const unit = attrs['Одиниця'] ?? 'шт'
        const weightFromName = attrs['Вага']

        // Вага — only if category supports it; match to closest standard MauDau weight
        if (!existing['Вага'] && hasAttr('Вага')) {
          const weightAttr = catAttrs.find((a: any) => a.name === 'Вага')
          const allowedWeights: string[] = weightAttr?.values ?? []
          const isWeightUnit = ['кг', 'г', 'мл', 'л'].includes(unit)
          let rawWeight = weightFromName ?? ''
          if (!rawWeight && isWeightUnit && minVal) {
            rawWeight = unit === 'кг' && minVal < 1
              ? `${Math.round(minVal * 1000)} г`
              : `${minVal} ${unit}`
          }
          if (rawWeight) {
            const matched = closestWeight(rawWeight, allowedWeights)
            if (matched) auto['Вага'] = matched
          }
        }

        // Торгова марка
        if (!existing['Торгова марка'] && p.brand) auto['Торгова марка'] = p.brand

        // Країна виробник — завжди перераховуємо з WC категорій (видаляємо з existing щоб auto виграв)
        const inferredCountry = inferCountry(p.categories ?? [])
        delete existing['Країна виробник']
        auto['Країна виробник'] = inferredCountry

        // Гарантія — use first allowed MauDau value (e.g. '<p>24 міс</p>'); leave empty if category has no allowed values
        if (!existing['Гарантія'] && hasAttr('Гарантія')) {
          const garAttr = catAttrs.find((a: any) => a.name === 'Гарантія')
          const firstVal = garAttr?.values?.[0]
          if (firstVal) auto['Гарантія'] = firstVal
        }

        const cats = p.categories ?? []

        // Тип обробки — завжди перераховуємо якщо категорія підтримує, інакше видаляємо
        delete existing['Тип обробки']
        if (hasAttr('Тип обробки')) {
          auto['Тип обробки'] = inferProcessing(p.name, cats)
        }

        // Тип — передаємо allowed values щоб inferType повернув тільки значення з категорії
        delete existing['Тип']
        if (hasAttr('Тип')) {
          const typeAttr = catAttrs.find((a: any) => a.name === 'Тип')
          const allowedTypes: string[] = typeAttr?.values ?? []
          const mType = inferType(p.name, allowedTypes)
          if (mType) auto['Тип'] = mType
        }

        // Сорт (Салямі, Пепероні і т.д.) — перераховуємо
        delete existing['Сорт']
        if (hasAttr('Сорт')) {
          const sortAttr = catAttrs.find((a: any) => a.name === 'Сорт')
          const allowedSorts: string[] = sortAttr?.values ?? []
          const mSort = inferSort(p.name, allowedSorts)
          if (mSort) auto['Сорт'] = mSort
        }

        // Добавки (Горіхи, Сир і т.д.) — перераховуємо
        delete existing['Добавки']
        if (hasAttr('Добавки')) {
          const dobAttr = catAttrs.find((a: any) => a.name === 'Добавки')
          const allowedDob: string[] = dobAttr?.values ?? []
          const mDob = inferDobavky(p.name, allowedDob)
          if (mDob) auto['Добавки'] = mDob
        }

        // Основа — перераховуємо; якщо null або категорія не підтримує — видаляємо
        delete existing['Основа']
        if (hasAttr('Основа')) {
          const mBase = inferBase(p.name, cats)
          if (mBase) auto['Основа'] = mBase
        }

        // Спосіб приготування — перераховуємо; якщо категорія не підтримує — видаляємо
        delete existing['Спосіб приготування']
        if (hasAttr('Спосіб приготування')) {
          const mType = auto['Тип'] ?? inferType(p.name)
          const mCooking = inferCookingMethods(mType ?? null, p.name)
          if (mCooking) auto['Спосіб приготування'] = mCooking
        }

        // Упаковка — НЕ чіпаємо (юзер має заповнити вручну, значення різні в кожній категорії)

        next[p.id] = { ...next[p.id], custom_params: { ...auto, ...existing } }
      })
      return next
    })
  }

  // filteredCategories — declared after filteredProducts (see below)

  // portal_id → attributes map for quick lookup
  const portalIdAttrsMap = useMemo(() => {
    const map: Record<string, { name: string; type: string; values: string[] }[]> = {}
    for (const cat of maudauCategories) {
      if (cat.portal_id && cat.attributes) map[cat.portal_id] = cat.attributes
    }
    return map
  }, [maudauCategories])

  // Filtered products list based on category filter setting
  const filteredProducts = useMemo(() => {
    return allProducts.filter(p => {
      const ov = overrides[p.id] ?? {}
      if (showOnlyInFeed && !savedFeedIds.has(p.id)) return false
      if (showOnlySelected && ov.is_active !== true) return false
      if (selectedCategories.length > 0) {
        if (!p.category_name || !selectedCategories.includes(p.category_name)) return false
      }
      if (productSearch) {
        if (!p.name.toLowerCase().includes(productSearch.toLowerCase())) return false
      }
      if (showOnlyWithIssues) {
        if (ov.is_active !== true) return false
        if (getProductIssues(p, ov).length === 0) return false
      }
      return true
    })
  }, [allProducts, selectedCategories, productSearch, showOnlySelected, showOnlyWithIssues, showOnlyInFeed, savedFeedIds, overrides, portalIdAttrsMap, slugToPortalIdClient, categoryPortalIds, isMaudau])

  // Reset to page 1 whenever filters change
  useEffect(() => {
    setCurrentPage(1)
  }, [allProducts, selectedCategories, productSearch, showOnlySelected, showOnlyWithIssues, showOnlyInFeed])

  // Categories: when a context filter is active, show only categories in filtered products
  const contextActiveCategories = useMemo(() => {
    if (!showOnlySelected && !showOnlyWithIssues && !showOnlyInFeed && !productSearch) return null
    const cats = new Set(filteredProducts.map(p => p.category_name).filter(Boolean) as string[])
    return cats
  }, [filteredProducts, showOnlySelected, showOnlyWithIssues, showOnlyInFeed, productSearch])

  const filteredCategories = useMemo(() => {
    const base = contextActiveCategories
      ? categories.filter(c => contextActiveCategories.has(c))
      : categories
    return base.filter(c => !categorySearch || c.toLowerCase().includes(categorySearch.toLowerCase()))
  }, [categories, categorySearch, contextActiveCategories])

  // Count actually selected (active) products across ALL products
  const selectedCount = useMemo(() =>
    allProducts.filter(p => overrides[p.id]?.is_active === true).length,
    [allProducts, overrides]
  )

  // Per-product validation issues
  function getProductIssues(p: any, ov: any): { type: 'error' | 'warn'; text: string }[] {
    const issues: { type: 'error' | 'warn'; text: string }[] = []
    if (!p.images || p.images.length === 0) issues.push({ type: 'error', text: 'Немає фото' })
    if (!p.brand) issues.push({ type: 'warn', text: 'Немає бренду' })
    const params = ov.custom_params ?? {}
    if (isMaudau && p.category_name) {
      const rawMapping = categoryPortalIds[p.category_name]
      if (!rawMapping) {
        issues.push({ type: 'warn', text: 'Категорія не зіставлена' })
      } else {
        // Resolve slug → numeric portal_id (same logic as getCatPortalId)
        const portalId = /^\d+$/.test(rawMapping) ? rawMapping : (slugToPortalIdClient[rawMapping] ?? '')
        const catAttrs = portalId ? (portalIdAttrsMap[portalId] ?? []) : []
        // Merge product attributes + custom_params (same logic as XML route)
        const allParams = { ...(p.attributes ?? {}), ...params }
        // Skip fields that are handled as dedicated XML tags or excluded from <param>
        const SKIP = new Set([
          'Гарантія', 'Азійські', 'Інша пропозиція', 'Спеціальні пропозиції', 'Десерти',
          'Тип обробки',       // → temperature_mode tag
          'Країна виробник',   // → country tag
          'Вага упаковки',     // excluded from XML
        ])
        const missing = catAttrs
          .filter(a => !SKIP.has(a.name) && !allParams[a.name])
          .map(a => a.name)
        const filledCount = Object.values(allParams).filter(v => v).length
        if (missing.length > 0 && filledCount < 3) {
          issues.push({ type: 'warn', text: `Відсутні: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ` +${missing.length - 3}` : ''}` })
        }
      }
    }
    return issues
  }

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
            ...(isRozetka ? { rozetka_category_ids: rzCategoryIds } : {}),
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
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex-1 min-w-[200px] space-y-1">
          <input
            value={feedName}
            onChange={e => setFeedName(e.target.value)}
            className="text-xl sm:text-2xl font-semibold text-white bg-transparent border-b border-transparent hover:border-zinc-700 focus:border-red-500 focus:outline-none w-full transition-colors"
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
        <div className="flex flex-wrap gap-2 sm:gap-3 items-center">
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="px-3 py-2 bg-zinc-900 hover:bg-red-950 border border-zinc-700 hover:border-red-700 text-zinc-500 hover:text-red-400 text-sm rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
            title="Видалити фід"
          >
            {deleting ? '⏳' : '🗑 Видалити'}
          </button>
          <div className="hidden sm:block w-px h-6 bg-zinc-800" />
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={handleSyncWC}
              disabled={syncingWC}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-sm rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap"
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
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-sm rounded-lg transition-colors whitespace-nowrap"
          >
            ↗ Переглянути XML
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {saving ? 'Збереження...' : '✓ Зберегти'}
          </button>
        </div>
      </div>

      {/* Compact settings bar */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 flex flex-wrap items-center gap-4">
        {/* Status */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500 whitespace-nowrap">Статус:</span>
          <select value={status} onChange={e => setStatus(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-red-500">
            <option value="active">Активний</option>
            <option value="draft">Чернетка</option>
            <option value="inactive">Вимкнений</option>
          </select>
        </div>
        <div className="w-px h-5 bg-zinc-700 hidden sm:block" />
        {/* Trigger tabs */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-zinc-500 mr-1 whitespace-nowrap">Тригер:</span>
          {[
            { value: 'manual', label: '🖱 Вручну' },
            { value: 'scheduled', label: '⏱ Розклад' },
            { value: 'webhook', label: '🔗 Вебхук' },
          ].map(opt => (
            <button key={opt.value} onClick={() => setTrigger(opt.value)}
              className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                trigger === opt.value ? 'bg-red-700 border-red-700 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-500'
              }`}>
              {opt.label}
            </button>
          ))}
        </div>
        {/* Cron inline (only when scheduled) */}
        {trigger === 'scheduled' && (
          <div className="flex items-center gap-2 flex-wrap">
            <input value={cronExpr} onChange={e => setCronExpr(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white font-mono w-28 focus:outline-none focus:border-red-500"
              placeholder="0 6 * * *" />
            <div className="flex gap-1">
              {[['6год','0 */6 * * *'],['День','0 6 * * *'],['Ніч','0 0 * * *']].map(([l,c]) => (
                <button key={c} onClick={() => setCronExpr(c)}
                  className="text-[10px] px-1.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded border border-zinc-700 transition-colors">{l}</button>
              ))}
            </div>
          </div>
        )}
        {/* Webhook hint */}
        {trigger === 'webhook' && (
          <span className="text-xs text-zinc-500 font-mono">POST /api/sync/woocommerce</span>
        )}
        {/* MauDau feed URL inline */}
        {isMaudau && (
          <>
            <div className="w-px h-5 bg-zinc-700 hidden sm:block" />
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs text-zinc-500 whitespace-nowrap shrink-0">🟣 URL фіду:</span>
              <code className="text-xs font-mono text-purple-300 bg-zinc-800 px-2 py-1 rounded flex-1 min-w-0 truncate select-all">
                https://hs-merchant.vercel.app/api/feeds/{feedSlug}
              </code>
              <button
                onClick={() => navigator.clipboard.writeText(`https://hs-merchant.vercel.app/api/feeds/${feedSlug}`)}
                className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-400 rounded transition-colors whitespace-nowrap shrink-0"
              >Копіювати</button>
            </div>
          </>
        )}
      </div>

      {/* Access stats — compact accordion row */}
      <FeedAccessStats feedId={feed.id} />

      {/* === PRODUCTS TABLE (full width) === */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden flex flex-col">

          {/* Header: search + counters */}
          <div className="px-4 pt-4 pb-3 border-b border-zinc-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-white whitespace-nowrap">Товари у фіді</h2>
                <div className="text-xs text-zinc-500 mt-0.5 whitespace-nowrap">
                  <span className="text-emerald-400 font-medium">{selectedCount}</span> вибрано
                  <span className="mx-1.5 text-zinc-700">·</span>
                  {filteredProducts.length !== allProducts.length
                    ? <><span className="text-white">{filteredProducts.length}</span> показано · {allProducts.length} всього</>
                    : <>{allProducts.length} всього</>}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => { setShowOnlyInFeed(v => !v); setShowOnlySelected(false); setShowOnlyWithIssues(false) }}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition-colors whitespace-nowrap ${
                    showOnlyInFeed
                      ? 'bg-blue-700 border-blue-700 text-white'
                      : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-blue-700'
                  }`}
                >
                  📋 Товари у фіді ({savedFeedIds.size})
                </button>
                <button
                  onClick={() => { setShowOnlySelected(v => !v); setShowOnlyWithIssues(false); setShowOnlyInFeed(false) }}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition-colors whitespace-nowrap ${
                    showOnlySelected
                      ? 'bg-emerald-600 border-emerald-600 text-white'
                      : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-500'
                  }`}
                >
                  {showOnlySelected ? '✓ Вибрані' : 'Вибрані'}
                </button>
                <button
                  onClick={() => { setShowOnlyWithIssues(v => !v); setShowOnlySelected(false); setShowOnlyInFeed(false) }}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition-colors whitespace-nowrap ${
                    showOnlyWithIssues
                      ? 'bg-red-700 border-red-700 text-white'
                      : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-red-700'
                  }`}
                >
                  ⚠ З помилками
                </button>
                <input
                  type="text"
                  placeholder="🔍 Пошук..."
                  value={productSearch}
                  onChange={e => setProductSearch(e.target.value)}
                  className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-red-500 w-36"
                />
                {isMaudau && (
                  <>
                    <button
                      onClick={translateAllEmpty}
                      disabled={bulkTranslating}
                      className="text-xs px-3 py-1.5 rounded-lg border border-purple-800 text-purple-300 hover:bg-purple-900/20 transition-colors disabled:opacity-50 whitespace-nowrap"
                    >
                      {bulkTranslating ? '⏳ Перекладаю...' : '🔄 Перекласти всі'}
                    </button>
                    <a
                      href={`/api/feeds/${feed.id}/export-xlsx`}
                      download="maudau-products.xlsx"
                      className="text-xs px-3 py-1.5 rounded-lg border border-emerald-800 text-emerald-300 hover:bg-emerald-900/20 transition-colors whitespace-nowrap"
                    >
                      📥 Експорт XLSX
                    </a>
                    <button
                      disabled={charXlsxLoading}
                      onClick={async () => {
                        setCharXlsxLoading(true)
                        setCharXlsxMsg('')
                        try {
                          const res = await fetch(`/api/feeds/${feed.id}/export-characteristics`)
                          if (!res.ok) {
                            const err = await res.json().catch(() => ({ error: `Помилка ${res.status}` }))
                            setCharXlsxMsg(err.error ?? `Помилка ${res.status}`)
                            return
                          }
                          const blob = await res.blob()
                          const url = URL.createObjectURL(blob)
                          const a = document.createElement('a')
                          const cd = res.headers.get('content-disposition') ?? ''
                          const nameMatch = cd.match(/filename="([^"]+)"/)
                          a.href = url
                          a.download = nameMatch?.[1] ?? 'characteristics.xlsx'
                          a.click()
                          URL.revokeObjectURL(url)
                        } catch (e: any) {
                          setCharXlsxMsg(e.message ?? 'Помилка завантаження')
                        } finally {
                          setCharXlsxLoading(false)
                        }
                      }}
                      className="text-xs px-3 py-1.5 rounded-lg border border-blue-800 text-blue-300 hover:bg-blue-900/20 transition-colors whitespace-nowrap disabled:opacity-50"
                    >
                      {charXlsxLoading ? '⏳ Формую...' : '📊 Характеристики XLSX'}
                    </button>
                    {charXlsxMsg && <span className="text-xs text-red-400">{charXlsxMsg}</span>}
                  </>
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
                {contextActiveCategories && (
                  <span className="text-xs text-zinc-600">• {filteredCategories.length} у фільтрі</span>
                )}
                <button
                  onClick={() => setCatBlockOpen(v => !v)}
                  className="ml-auto text-[10px] px-2 py-0.5 rounded border border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  {catBlockOpen ? '▲ Згорнути' : '▼ Розгорнути'}
                </button>
              </div>
              {catBlockOpen && (
                <>
                  <input
                    type="text"
                    placeholder="Пошук категорії..."
                    value={categorySearch}
                    onChange={e => setCategorySearch(e.target.value)}
                    className="w-full mb-2 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-red-500"
                  />
                  <div className="flex flex-wrap gap-1.5">
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
                </>
              )}
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
         <div className="overflow-x-auto">
          <div className={FEED_MIN_W}>
          <div className="grid gap-2 px-4 py-2 bg-zinc-800/50 border-b border-zinc-800"
            style={{ gridTemplateColumns: FEED_COLS }}>
            <div className="text-xs text-zinc-600">✓</div>
            <div />
            <div />
            <div className="text-xs text-zinc-600 uppercase tracking-wide">Товар</div>
            <div className="text-xs text-zinc-600 uppercase tracking-wide text-center">Од.</div>
            <div className="text-xs text-zinc-600 uppercase tracking-wide text-center">Мін.</div>
            <div className="text-xs text-zinc-600 uppercase tracking-wide text-center">Крок</div>
            <div className="text-xs text-zinc-600 uppercase tracking-wide text-right">Ціна WC</div>
            <div className="text-xs text-zinc-600 uppercase tracking-wide text-right">Акційна WC</div>
            <div className="text-xs text-zinc-600 uppercase tracking-wide text-right">Залишок</div>
            <div className="text-xs text-zinc-600 uppercase tracking-wide text-right">Ціна М</div>
            <div className="text-xs text-zinc-600 uppercase tracking-wide text-right">Акц. М</div>
          </div>

          <div className="overflow-y-auto divide-y divide-zinc-800/60" style={{ minHeight: 400, maxHeight: 'calc(100vh - 420px)' }}>
            {filteredProducts.length === 0 && (
              <div className="py-12 text-center text-zinc-600 text-sm">Немає товарів</div>
            )}
            {filteredProducts.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE).map(p => {
              const ov = overrides[p.id] ?? {}
              const isActive = ov.is_active === true
              const inSavedFeed = savedFeedIds.has(p.id)
              const isExpanded = expandedProduct === p.id
              const thumb = p.images?.[0]
              const issues = getProductIssues(p, ov)
              const hasErrors = issues.some(i => i.type === 'error')
              const hasWarns = issues.some(i => i.type === 'warn')
              const paramCount = Object.keys(ov.custom_params ?? {}).length
              const fewParams = isActive && paramCount < 3
              const stock = ov.custom_stock !== '' && ov.custom_stock != null
                ? Number(ov.custom_stock)
                : p.stock

              // MauDau structured attrs for expanded view
              const curParams = ov.custom_params ?? {}
              const catPortalId = isMaudau ? (curParams['_maudau_category'] || getCatPortalId(p.category_name ?? '')) : ''
              const catAttrsExp: { name: string; type: string; values: string[] }[] = catPortalId ? (portalIdAttrsMap[catPortalId] ?? []) : []
              const catAttrNames = new Set(catAttrsExp.map(a => a.name))
              const extraParams = Object.entries(curParams).filter(([k]) => !catAttrNames.has(k) && k !== '_maudau_category')
              const setParam = (key: string, value: string) =>
                setOverride(p.id, 'custom_params', { ...curParams, [key]: value })
              const clearParam = (key: string) => {
                const next = { ...curParams }
                delete next[key]
                setOverride(p.id, 'custom_params', next)
              }

              // Attributes for display + per-100g calc
              const attrs = p.attributes
              const unitBase = attrs?.['Одиниця'] ?? null
              const minVal = attrs?.['Мін'] ?? null
              const stepVal = attrs?.['Вага'] ?? attrs?.['Крок'] ?? null

              // Effective WC price (what's in the WC product right now)
              const wcPrice = Number(p.price)
              const wcOldPrice = p.price_old != null ? Number(p.price_old) : null

              // Marketplace price = custom_price override if set, else WC current price
              const mPrice = ov.custom_price && ov.custom_price !== '' ? parseFloat(ov.custom_price) : wcPrice
              // Marketplace old price = WC old price (sale comparison), not affected by custom_price
              const mOldPrice = wcOldPrice

              // Marketplace price: for кг/л — price×min_kg (default 0.4); for г/мл — price as-is; null = piece
              const mPriceCalc = calcMarketplacePrice(mPrice, attrs)
              const mOldPriceCalc = mOldPrice != null ? calcMarketplacePrice(mOldPrice, attrs) : null

              const displayMPrice = mPriceCalc !== null ? mPriceCalc : mPrice
              const displayMOldPrice = mOldPrice != null ? (mOldPriceCalc !== null ? mOldPriceCalc : mOldPrice) : null
              const isWeightProduct = mPriceCalc !== null

              // Min weight label for product name (weight products only, converted to grams)
              const minWeightLabel = (() => {
                if (!unitBase) return null
                const u = unitBase.toLowerCase()
                const minRaw = parseFloat(attrs?.['Мін'] ?? '0') || 0
                if (u === 'кг' || u === 'л') return `${minRaw > 0 ? Math.round(minRaw * 1000) : 400} г`
                if (u === 'г' || u === 'мл') return `${minRaw > 0 ? Math.round(minRaw) : 400} ${u}`
                return null
              })()

              return (
                <div key={p.id} className={`transition-colors border-l-2 ${
                  isActive && hasErrors ? 'border-red-600' :
                  isActive && hasWarns ? 'border-amber-600' :
                  inSavedFeed && !isActive ? 'border-orange-700' :
                  'border-transparent'
                } ${isActive ? 'hover:bg-zinc-800/30' : 'opacity-35 hover:opacity-60'}`}>
                  <div className="grid gap-2 px-4 py-2 items-center"
                    style={{ gridTemplateColumns: FEED_COLS }}>
                    {/* Checkbox */}
                    <input
                      type="checkbox"
                      checked={isActive}
                      onChange={e => setOverride(p.id, 'is_active', e.target.checked)}
                      className="accent-red-500 cursor-pointer"
                    />
                    {/* Feed membership indicator */}
                    <div title={inSavedFeed ? 'У збереженому фіді' : 'Не у фіді'}>
                      <div className={`w-1.5 h-1.5 rounded-full ${inSavedFeed ? 'bg-blue-500' : 'bg-zinc-700'}`} />
                    </div>

                    {/* Thumbnail */}
                    <div className={`w-8 h-8 rounded overflow-hidden shrink-0 flex items-center justify-center ${!thumb ? 'bg-red-950 border border-red-800' : 'bg-zinc-800'}`}>
                      {thumb
                        ? <img src={thumb} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                        : <span className="text-red-500 text-[10px] font-bold">!</span>}
                    </div>

                    {/* Name + category + issues */}
                    <div className="min-w-0">
                      <button
                        onClick={() => setExpandedProduct(isExpanded ? null : p.id)}
                        className="text-left w-full cursor-pointer"
                      >
                        <div className="text-xs text-white font-medium leading-snug flex items-start gap-1 flex-wrap">
                          <span className="text-zinc-600 shrink-0 mt-px">{isExpanded ? '▾' : '▸'}</span>
                          <span className="line-clamp-1">
                            {p.name}{minWeightLabel && <span className="text-zinc-400">, {minWeightLabel}</span>}
                          </span>
                        </div>
                        <div className="text-[11px] text-zinc-500 mt-0.5 truncate">{p.category_name}</div>
                        {isActive && issues.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {issues.map((iss, i) => (
                              <span key={i} className={`text-[9px] px-1.5 py-px rounded leading-tight border ${
                                iss.type === 'error'
                                  ? 'bg-red-950/70 text-red-400 border-red-800/50'
                                  : 'bg-amber-950/70 text-amber-400 border-amber-800/50'
                              }`}>
                                {iss.type === 'error' ? '✕' : '⚠'} {iss.text}
                              </span>
                            ))}
                          </div>
                        )}
                      </button>
                    </div>

                    {/* Од. */}
                    <div className="text-xs text-zinc-500 text-center">{unitBase ?? '—'}</div>

                    {/* Мін. */}
                    <div className="text-xs text-zinc-400 text-center">{minVal ?? <span className="text-zinc-700">—</span>}</div>

                    {/* Крок */}
                    <div className="text-xs text-center">
                      {stepVal ? <span className={stepVal === minVal ? 'text-blue-400' : 'text-amber-400'}>{stepVal}</span> : <span className="text-zinc-700">—</span>}
                    </div>

                    {/* Price (WC custom override input) */}
                    <div>
                      <input
                        type="number"
                        placeholder={String(p.price ?? '')}
                        value={ov.custom_price ?? ''}
                        onChange={e => setOverride(p.id, 'custom_price', e.target.value)}
                        className="w-full bg-zinc-800 border border-zinc-700 rounded px-1.5 py-1 text-xs text-white text-right focus:outline-none focus:border-amber-500 placeholder:text-zinc-500"
                      />
                    </div>

                    {/* Sale price WC (price_old = original, price = discounted) */}
                    <div className="text-right">
                      {wcOldPrice != null ? (
                        <div>
                          <div className="text-xs text-emerald-400 font-medium">{wcPrice} ₴</div>
                          <div className="text-[10px] text-zinc-500 line-through">{wcOldPrice} ₴</div>
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

                    {/* Ціна М — marketplace price per min portion (weight) or as-is (piece) */}
                    <div className="text-right">
                      <div className={`text-xs font-semibold ${wcOldPrice != null ? 'text-emerald-400' : 'text-white'}`}>
                        {displayMPrice} ₴
                      </div>
                    </div>

                    {/* Акц. М — original price per min portion when product is on sale */}
                    <div className="text-right">
                      {displayMOldPrice != null ? (
                        <div className="text-xs text-zinc-500 line-through">{displayMOldPrice} ₴</div>
                      ) : (
                        <span className="text-xs text-zinc-600">—</span>
                      )}
                    </div>
                  </div>

                  {/* Expanded: site fields + MauDau characteristics */}
                  {isExpanded && (
                    <div className="bg-zinc-800/20 border-t border-zinc-800/60">
                      <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-zinc-800/60">

                        {/* ── LEFT: Поля з сайту ── */}
                        <div className="px-4 py-3 space-y-2">
                          <p className="text-[10px] text-zinc-600 uppercase tracking-wider font-medium mb-2">З сайту</p>

                          {/* Name */}
                          <div>
                            <label className="text-[11px] text-zinc-500 block mb-0.5">Назва</label>
                            <p className="text-xs text-zinc-300 leading-snug">{p.name}</p>
                          </div>

                          {/* Category */}
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-zinc-500 w-20 shrink-0">Категорія:</span>
                            <span className="text-xs text-zinc-300 truncate">{p.category_name ?? '—'}</span>
                          </div>

                          {/* Brand */}
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-zinc-500 w-20 shrink-0">Бренд:</span>
                            <span className={`text-xs ${p.brand ? 'text-zinc-300' : 'text-red-400'}`}>{p.brand ?? 'відсутній'}</span>
                          </div>

                          {/* Price + stock */}
                          <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] text-zinc-500 w-20 shrink-0">Ціна:</span>
                              <span className="text-xs text-zinc-300">{p.price} ₴{p.price_old ? <span className="text-zinc-600 line-through ml-1">{p.price_old} ₴</span> : null}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] text-zinc-500 shrink-0">Залишок:</span>
                              <span className={`text-xs ${p.stock == null ? 'text-zinc-500' : p.stock > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {p.stock == null ? '∞' : p.stock}
                              </span>
                            </div>
                          </div>

                          {/* Site attributes */}
                          {p.attributes && Object.keys(p.attributes).length > 0 && (
                            <div>
                              <p className="text-[10px] text-zinc-600 mb-1">Атрибути з WC:</p>
                              <div className="space-y-1">
                                {Object.entries(p.attributes).map(([k, v]) => (
                                  <div key={k} className="flex items-start gap-2">
                                    <span className="text-[11px] text-zinc-500 w-28 shrink-0 truncate">{k}:</span>
                                    <span className="text-[11px] text-zinc-300 break-words">{String(v)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Custom price/stock overrides */}
                          <div className="pt-1 space-y-1.5 border-t border-zinc-800/40">
                            <p className="text-[10px] text-zinc-600">Перевизначення:</p>
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] text-zinc-500 w-20 shrink-0">Ціна:</span>
                              <input
                                type="number"
                                placeholder={String(p.price ?? '')}
                                value={ov.custom_price ?? ''}
                                onChange={e => setOverride(p.id, 'custom_price', e.target.value)}
                                className="w-28 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500 placeholder:text-zinc-600"
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] text-zinc-500 w-20 shrink-0">Залишок:</span>
                              <input
                                type="number"
                                placeholder={String(p.stock ?? '')}
                                value={ov.custom_stock ?? ''}
                                onChange={e => setOverride(p.id, 'custom_stock', e.target.value)}
                                className="w-28 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500 placeholder:text-zinc-600"
                              />
                            </div>
                          </div>

                          {/* MauDau translations */}
                          {isMaudau && (
                            <div className="space-y-2 pt-1 border-t border-zinc-800/40">
                              <p className="text-[10px] text-zinc-600">Переклад (рос.):</p>
                              <div>
                                <div className="flex items-center justify-between mb-0.5">
                                  <label className="text-[11px] text-zinc-500">name_ru</label>
                                  <button
                                    type="button"
                                    disabled={translating[`${p.id}:name_ru`]}
                                    onClick={() => translateField(p.id, 'name_ru', productFullName(p, ov.custom_name))}
                                    className="text-[10px] text-purple-400 hover:text-purple-300 disabled:opacity-40 transition-colors"
                                  >{translating[`${p.id}:name_ru`] ? '⏳' : '🔄'}</button>
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
                                    disabled={translating[`${p.id}:description_ru`] || !(ov.custom_params?.['Опис']?.trim() || p.description?.trim())}
                                    onClick={() => translateField(p.id, 'description_ru', ov.custom_params?.['Опис']?.trim() || p.description?.trim() || '')}
                                    className="text-[10px] text-purple-400 hover:text-purple-300 disabled:opacity-40 transition-colors"
                                  >{translating[`${p.id}:description_ru`] ? '⏳' : '🔄'}</button>
                                </div>
                                <textarea
                                  placeholder="Опис рос. мовою..."
                                  value={ov.description_ru ?? ''}
                                  onChange={e => {
                                    e.target.style.height = 'auto'
                                    e.target.style.height = e.target.scrollHeight + 'px'
                                    setOverride(p.id, 'description_ru', e.target.value)
                                  }}
                                  ref={el => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' } }}
                                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-purple-500 placeholder:text-zinc-600 resize-none overflow-hidden"
                                />
                              </div>
                            </div>
                          )}
                        </div>

                        {/* ── RIGHT: Характеристики MauDau ── */}
                        <div className="px-4 py-3 space-y-2">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-[10px] text-zinc-600 uppercase tracking-wider font-medium">Характеристики MauDau</p>
                            <button
                              type="button"
                              onClick={() => {
                                const key = `Параметр ${Object.keys(curParams).length + 1}`
                                setParam(key, '')
                              }}
                              className="text-[10px] px-2 py-0.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded transition-colors"
                            >+ Додати</button>
                          </div>

                          {/* Per-product Rozetka category and characteristics */}
                          {isRozetka && (() => {
                            const catId = curParams['_rz_category'] || (rzCategoryIds[p.category_name ?? ''] ?? '')
                            const attrs = catId ? (rzAttrs[catId] ?? []) : []
                            const inherited = rzCategoryIds[p.category_name ?? ''] ?? ''
                            const inheritedTitle = rzCategories.find(c => String(c.id) === inherited)?.title
                            return (
                              <div className="mb-3 space-y-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-[11px] text-zinc-400 whitespace-nowrap shrink-0 w-28">Rozetka кат.:</span>
                                  <div className="flex-1 min-w-0">
                                    <RozetkaCatDropdown
                                      value={curParams['_rz_category'] ?? ''}
                                      categories={rzCategories}
                                      onChange={v => {
                                        if (v) { setParam('_rz_category', v); void loadRzAttrs(v) }
                                        else clearParam('_rz_category')
                                      }}
                                    />
                                  </div>
                                </div>
                                {!curParams['_rz_category'] && (
                                  <p className="text-[10px] text-zinc-600 pl-[7.5rem]">
                                    {inheritedTitle
                                      ? `за категорією «${p.category_name}» → ${inheritedTitle}`
                                      : 'категорію не задано — товар не потрапить у фід'}
                                  </p>
                                )}

                                {attrs.length > 0 && (
                                  <div className="space-y-1.5 pt-1">
                                    <p className="text-[10px] text-zinc-600">
                                      Характеристики Rozetka — порожні успадковують значення категорії
                                    </p>
                                    {attrs.map(attr => {
                                      const key = rzParamKey(attr.id)
                                      const val = curParams[key] ?? ''
                                      return (
                                        <div key={attr.id} className="flex items-center gap-2">
                                          <span className="w-28 shrink-0 text-[11px] text-zinc-400 truncate"
                                                title={`${attr.title} · ${attr.type}`}>
                                            {attr.title}{attr.unit ? `, ${attr.unit}` : ''}
                                          </span>
                                          {attr.values.length > 0 ? (
                                            <div className="flex-1 min-w-0">
                                              <SearchableSelect
                                                value={val}
                                                options={attr.values.map(v => ({ value: v.value, label: v.value }))}
                                                onChange={v => v ? setParam(key, v) : clearParam(key)}
                                                placeholder="— Обрати —"
                                                emptyLabel="— прибрати —"
                                                accentColor="purple"
                                              />
                                            </div>
                                          ) : (
                                            <input
                                              type="text"
                                              defaultValue={val}
                                              onBlur={e => {
                                                if (e.target.value === val) return
                                                e.target.value ? setParam(key, e.target.value) : clearParam(key)
                                              }}
                                              className="flex-1 min-w-0 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:border-purple-500"
                                            />
                                          )}
                                        </div>
                                      )
                                    })}
                                  </div>
                                )}
                              </div>
                            )
                          })()}

                          {/* Per-product MauDau category override */}
                          {isMaudau && (() => {
                            const autoMauCat = maudauCategories.find(c => c.portal_id === catPortalId)
                            const autoLabel = autoMauCat ? autoMauCat.title : p.category_name
                            return (
                              <div className="flex items-center gap-2 mb-3">
                                <span className="text-[11px] text-zinc-400 whitespace-nowrap shrink-0 w-28">MauDau кат.:</span>
                                <select
                                  value={curParams['_maudau_category'] ?? ''}
                                  onChange={e => {
                                    const v = e.target.value
                                    if (v) setParam('_maudau_category', v)
                                    else clearParam('_maudau_category')
                                  }}
                                  className="flex-1 min-w-0 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:border-purple-500"
                                >
                                  <option value="">— авто: {autoLabel} —</option>
                                  {maudauCategories
                                    .filter(c => c.portal_id)
                                    .sort((a, b) => a.title.localeCompare(b.title, 'uk'))
                                    .map(c => (
                                      <option key={c.portal_id} value={c.portal_id!}>{c.title}</option>
                                    ))}
                                </select>
                              </div>
                            )
                          })()}

                          {/* Ціна на маркетплейсі */}
                          {isMaudau && (() => {
                            const unit = (p.attributes as any)?.['Одиниця'] ?? ''
                            const isVagova = ['кг', 'г', 'мл', 'л'].includes(unit.toLowerCase())
                            const effectivePrice = ov.custom_price ? Number(ov.custom_price) : p.price
                            const priceVal = curParams['Ціна на маркетплейсі'] ?? ''
                            const PREFIX = 'Цена указана за 1 кг!\n'
                            const ensurePrefix = () => {
                              if (!isVagova) return
                              const current = ov.description_ru ?? ''
                              if (!current.startsWith(PREFIX)) {
                                setOverride(p.id, 'description_ru', PREFIX + current)
                              }
                            }
                            return (
                              <div className="flex items-center gap-1.5 mb-1">
                                <span className="w-28 shrink-0 text-[11px] text-zinc-400 truncate">Ціна на маркетплейсі</span>
                                <span className="text-zinc-600 text-xs shrink-0">:</span>
                                <input
                                  type="number"
                                  value={priceVal || effectivePrice}
                                  onChange={e => {
                                    setParam('Ціна на маркетплейсі', e.target.value)
                                    ensurePrefix()
                                  }}
                                  onFocus={ensurePrefix}
                                  className="flex-1 min-w-0 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-1 text-[11px] text-white focus:outline-none focus:border-zinc-500"
                                />
                                {isVagova && (
                                  <span className="text-[10px] text-amber-400 shrink-0 whitespace-nowrap">за 1 кг</span>
                                )}
                              </div>
                            )
                          })()}

                          {/* Structured MauDau attrs */}
                          {catAttrsExp.length > 0 && (
                            <div className="space-y-1.5">
                              {catAttrsExp.map((attr: any) => {
                                const val: string = attr.name === 'Вага'
                                  ? (curParams['Вага'] ?? curParams['Вага упаковки'] ?? '')
                                  : (curParams[attr.name] ?? '')
                                const isEmpty = !val
                                const rawValues: string[] = attr.values ?? []
                                const hasDropdown = rawValues.length > 0

                                return (
                                  <div key={attr.name} className="flex items-center gap-1.5">
                                    <span className={`w-28 shrink-0 text-[11px] truncate ${isEmpty ? 'text-amber-400' : 'text-zinc-400'}`}>
                                      {attr.name}
                                    </span>
                                    <span className="text-zinc-600 text-xs shrink-0">:</span>
                                    {hasDropdown ? (
                                      <div className="flex-1 min-w-0">
                                        <SearchableSelect
                                          value={val}
                                          options={rawValues.map((rv: string) => ({ value: rv, label: stripHtml(rv) }))}
                                          onChange={v => setParam(attr.name, v)}
                                          placeholder="— Обрати —"
                                          emptyLabel="— прибрати —"
                                          isEmpty={isEmpty}
                                        />
                                      </div>
                                    ) : (
                                      <input
                                        type="text"
                                        value={val}
                                        onChange={e => setParam(attr.name, e.target.value)}
                                        className={`flex-1 min-w-0 rounded px-1.5 py-1 text-[11px] text-white focus:outline-none ${
                                          isEmpty
                                            ? 'bg-amber-950/30 border border-amber-600 focus:border-amber-400'
                                            : 'bg-zinc-800 border border-zinc-700 focus:border-zinc-500'
                                        }`}
                                        placeholder="Значення"
                                      />
                                    )}
                                    {val && (
                                      <button
                                        type="button"
                                        onClick={() => clearParam(attr.name)}
                                        className="text-zinc-600 hover:text-red-400 text-xs px-1 transition-colors shrink-0"
                                      >✕</button>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          )}

                          {/* Extra / custom params */}
                          {(catAttrsExp.length === 0 ? Object.entries(curParams) : extraParams).length > 0 && (
                            <div className={`space-y-1.5 ${catAttrsExp.length > 0 ? 'mt-2 pt-2 border-t border-zinc-800/40' : ''}`}>
                              {catAttrsExp.length > 0 && extraParams.length > 0 && (
                                <p className="text-[10px] text-zinc-600 mb-1">Додаткові поля</p>
                              )}
                              {(catAttrsExp.length === 0 ? Object.entries(curParams) : extraParams).map(([key, val]) => (
                                <div key={key} className="flex items-center gap-1.5">
                                  <input
                                    type="text"
                                    defaultValue={key}
                                    onBlur={e => {
                                      const newKey = e.target.value.trim()
                                      if (!newKey || newKey === key) return
                                      const next = { ...curParams }
                                      const v = next[key]
                                      delete next[key]
                                      next[newKey] = v
                                      setOverride(p.id, 'custom_params', next)
                                    }}
                                    className="w-28 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-1 text-[11px] text-zinc-300 focus:outline-none focus:border-zinc-500"
                                    placeholder="Назва"
                                  />
                                  <span className="text-zinc-600 text-xs">:</span>
                                  <input
                                    type="text"
                                    value={val}
                                    onChange={e => setParam(key, e.target.value)}
                                    className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-1 text-[11px] text-white focus:outline-none focus:border-zinc-500"
                                    placeholder="Значення"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => clearParam(key)}
                                    className="text-zinc-600 hover:text-red-400 text-xs px-1 transition-colors"
                                  >✕</button>
                                </div>
                              ))}
                            </div>
                          )}

                          {catAttrsExp.length === 0 && Object.keys(curParams).filter(k => k !== '_maudau_category').length === 0 && (
                            <p className="text-[11px] text-zinc-600">Немає характеристик. Натисніть "+ Додати".</p>
                          )}
                        </div>

                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          </div>
         </div>

          {/* Pagination — outside the scroller so it stays reachable */}
          {filteredProducts.length > PAGE_SIZE && (
            <div className="px-4 py-3 border-t border-zinc-800 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-zinc-500">
                {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filteredProducts.length)} з {filteredProducts.length}
              </span>
              <div className="flex flex-wrap items-center gap-1">
                <button
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  className="text-xs px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-400 rounded disabled:opacity-30 transition-colors"
                >← Назад</button>
                {Array.from({ length: Math.ceil(filteredProducts.length / PAGE_SIZE) }, (_, i) => i + 1)
                  .filter(pg => pg === 1 || pg === Math.ceil(filteredProducts.length / PAGE_SIZE) || Math.abs(pg - currentPage) <= 2)
                  .reduce<(number | '...')[]>((acc, pg, i, arr) => {
                    if (i > 0 && pg - (arr[i - 1] as number) > 1) acc.push('...')
                    acc.push(pg)
                    return acc
                  }, [])
                  .map((pg, i) => pg === '...'
                    ? <span key={`e${i}`} className="text-xs text-zinc-600 px-1">…</span>
                    : <button
                        key={pg}
                        onClick={() => setCurrentPage(pg as number)}
                        className={`text-xs px-2.5 py-1 rounded border transition-colors ${
                          currentPage === pg
                            ? 'bg-red-700 border-red-700 text-white'
                            : 'bg-zinc-800 hover:bg-zinc-700 border-zinc-700 text-zinc-400'
                        }`}
                      >{pg}</button>
                  )}
                <button
                  disabled={currentPage === Math.ceil(filteredProducts.length / PAGE_SIZE)}
                  onClick={() => setCurrentPage(p => Math.min(Math.ceil(filteredProducts.length / PAGE_SIZE), p + 1))}
                  className="text-xs px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-400 rounded disabled:opacity-30 transition-colors"
                >Вперед →</button>
              </div>
            </div>
          )}
      </div>

      {/* MauDau: Category portal_id mapping */}
      {isRozetka && (
        <div className="bg-zinc-900 border border-purple-900/50 rounded-xl p-4 w-1/2 min-w-[320px]">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-white">🟢 Rozetka — категорії</h2>
              {rzCatsLoading && <span className="text-xs text-zinc-500">Завантаження...</span>}
              {rzCategories.length > 0 && (
                <span className="text-xs text-zinc-600">• {rzCategories.length} кат.</span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={syncRzCategories}
                disabled={rzSyncing}
                className="text-xs px-2.5 py-1 rounded-lg border border-purple-800 text-purple-400 hover:bg-purple-900/20 transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                {rzSyncing ? '⏳...' : '🔄 Категорії'}
              </button>
              {rzSyncMsg && <span className="text-xs text-zinc-400">{rzSyncMsg}</span>}
            </div>
          </div>

          {rzCatsError && <p className="text-xs text-amber-400 mb-3">{rzCatsError}</p>}

          {activeCategories.length === 0 ? (
            <p className="text-xs text-zinc-600">Спочатку виберіть товари у фіді.</p>
          ) : (
            <>
              <input
                type="text"
                placeholder="🔍 Пошук по своїх категоріях..."
                value={rzBlockSearch}
                onChange={e => setRzBlockSearch(e.target.value)}
                className="w-full mb-3 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-purple-500"
              />

              <div className="grid grid-cols-[1fr_1fr_56px] gap-2 px-2 py-1 mb-1">
                <span className="text-[10px] text-zinc-600 uppercase tracking-wide">Категорія на сайті</span>
                <span className="text-[10px] text-zinc-600 uppercase tracking-wide">Категорія на Rozetka</span>
                <span className="text-[10px] text-zinc-600 uppercase tracking-wide text-center">Атр.</span>
              </div>

              <div className="space-y-0.5">
                {activeCategories
                  .filter(cat => !rzBlockSearch || cat.toLowerCase().includes(rzBlockSearch.toLowerCase()))
                  .map(cat => {
                    const rzId = rzCategoryIds[cat] ?? ''
                    const attrs = rzId ? (rzAttrs[rzId] ?? []) : []
                    const loading = !!rzAttrsLoading[rzId]
                    const expanded = rzExpandedCats.has(cat)

                    return (
                      <div key={cat} className="border border-zinc-800/60 rounded-lg overflow-hidden">
                        <div className="grid grid-cols-[1fr_1fr_56px] gap-2 px-2 py-1.5 items-center bg-zinc-900">
                          <span className="text-xs text-zinc-300 truncate">{cat}</span>

                          <RozetkaCatDropdown
                            value={rzId}
                            categories={rzCategories}
                            onChange={v => {
                              setRzCategoryIds(prev => ({ ...prev, [cat]: v }))
                              if (v) void loadRzAttrs(v)
                            }}
                          />

                          <button
                            type="button"
                            disabled={!rzId}
                            onClick={() => {
                              void loadRzAttrs(rzId)
                              setRzExpandedCats(prev => {
                                const next = new Set(prev)
                                if (next.has(cat)) next.delete(cat); else next.add(cat)
                                return next
                              })
                            }}
                            className={`text-center text-[10px] px-1.5 py-1 rounded border transition-colors ${
                              !rzId
                                ? 'border-zinc-800 text-zinc-700 cursor-not-allowed'
                                : expanded
                                  ? 'bg-purple-900/40 border-purple-700 text-purple-300'
                                  : 'border-zinc-700 text-zinc-500 hover:border-purple-600 hover:text-purple-400'
                            }`}
                            title={rzId ? `${attrs.length} характеристик` : 'Спершу оберіть категорію Rozetka'}
                          >
                            {loading ? '…' : rzId ? (expanded ? `▲${attrs.length}` : `▼${attrs.length}`) : '—'}
                          </button>
                        </div>

                        {expanded && rzId && (
                          <div className="px-3 py-3 bg-zinc-800/30 border-t border-zinc-800 space-y-2">
                            <div className="flex items-center justify-between mb-1 gap-2">
                              <p className="text-[10px] text-zinc-500">
                                Заповнене застосується до всіх активних товарів у «{cat}»
                              </p>
                              <button
                                type="button"
                                onClick={() => void loadRzAttrs(rzId, true)}
                                className="text-[10px] text-purple-400 hover:text-purple-300 whitespace-nowrap shrink-0"
                              >
                                ↻ Оновити з Rozetka
                              </button>
                            </div>

                            {loading && <p className="text-[10px] text-zinc-500">Завантаження характеристик…</p>}
                            {!loading && attrs.length === 0 && (
                              <p className="text-[10px] text-zinc-600">Ця категорія не має характеристик.</p>
                            )}

                            {attrs.map(attr => {
                              const sample = allProducts.find(p =>
                                p.category_name === cat && overrides[p.id]?.is_active)
                              const val = sample
                                ? (overrides[sample.id]?.custom_params?.[rzParamKey(attr.id)] ?? '')
                                : ''
                              return (
                                <div key={attr.id} className="flex items-center gap-2">
                                  <span className="w-36 shrink-0 text-[11px] text-zinc-400 truncate"
                                        title={`${attr.title} · ${attr.type}`}>
                                    {attr.title}{attr.unit ? `, ${attr.unit}` : ''}
                                  </span>
                                  <span className="text-zinc-600 text-xs shrink-0">:</span>
                                  {attr.values.length > 0 ? (
                                    <div className="flex-1">
                                      <SearchableSelect
                                        value={val}
                                        options={attr.values.map(v => ({ value: v.value, label: v.value }))}
                                        onChange={v => setRzCatDefault(cat, attr.id, v)}
                                        placeholder="— Обрати —"
                                        emptyLabel="— прибрати —"
                                        accentColor="purple"
                                      />
                                    </div>
                                  ) : (
                                    <input
                                      type="text"
                                      defaultValue={val}
                                      onBlur={e => {
                                        if (e.target.value !== val) setRzCatDefault(cat, attr.id, e.target.value)
                                      }}
                                      className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-1 text-[11px] text-white focus:outline-none focus:border-purple-500"
                                      placeholder="Значення для всіх товарів..."
                                    />
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                {activeCategories.filter(cat => !rzBlockSearch || cat.toLowerCase().includes(rzBlockSearch.toLowerCase())).length === 0 && (
                  <p className="text-xs text-zinc-600 py-2">Нічого не знайдено</p>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {isMaudau && (
        <div className="bg-zinc-900 border border-purple-900/50 rounded-xl p-4 w-1/2 min-w-[320px]">
          {/* Header row */}
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-white">🟣 MauDau — категорії</h2>
              {maudauCatsLoading && <span className="text-xs text-zinc-500">Завантаження...</span>}
              {maudauCategories.length > 0 && (
                <span className="text-xs text-zinc-600">• {maudauCategories.length} кат.</span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={handleSyncAllCategories}
                disabled={syncingCats}
                className="text-xs px-2.5 py-1 rounded-lg border border-purple-800 text-purple-400 hover:bg-purple-900/20 transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                {syncingCats ? '⏳...' : '🔄 Категорії'}
              </button>
              {/* Upload MauDau export to refresh sku→id mapping */}
              <label className="text-xs px-2.5 py-1 rounded-lg border border-zinc-700 text-zinc-400 hover:border-purple-700 hover:text-purple-400 transition-colors cursor-pointer whitespace-nowrap">
                📥 Оновити ID товарів
                <input
                  type="file"
                  accept=".xlsx"
                  className="hidden"
                  onChange={async e => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    e.target.value = ''
                    setSyncCatsMsg('⏳ Завантаження...')
                    const fd = new FormData()
                    fd.append('file', file)
                    try {
                      const res = await fetch('/api/maudau/upload-product-ids', { method: 'POST', body: fd })
                      const d = await res.json()
                      if (!res.ok) setSyncCatsMsg(`❌ ${d.error}`)
                      else setSyncCatsMsg(`✅ Оновлено ${d.count} ID`)
                    } catch {
                      setSyncCatsMsg('❌ Помилка завантаження')
                    }
                  }}
                />
              </label>
              {syncCatsMsg && <span className="text-xs text-zinc-400">{syncCatsMsg}</span>}
            </div>
          </div>

          {maudauCatsError && <p className="text-xs text-red-400 mb-3">{maudauCatsError}</p>}

          {activeCategories.length === 0 ? (
            <p className="text-xs text-zinc-600">Спочатку виберіть товари у фіді.</p>
          ) : (
            <>
              {/* Search */}
              <input
                type="text"
                placeholder="🔍 Пошук по своїх категоріях..."
                value={maudauBlockSearch}
                onChange={e => setMaudauBlockSearch(e.target.value)}
                className="w-full mb-3 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-purple-500"
              />

              {/* Column headers */}
              <div className="grid grid-cols-[1fr_1fr_56px] gap-2 px-2 py-1 mb-1">
                <span className="text-[10px] text-zinc-600 uppercase tracking-wide">Категорія на сайті</span>
                <span className="text-[10px] text-zinc-600 uppercase tracking-wide">Категорія на MauDau</span>
                <span className="text-[10px] text-zinc-600 uppercase tracking-wide text-center">Атр.</span>
              </div>

              <div className="space-y-0.5">
                {activeCategories
                  .filter(cat => !maudauBlockSearch || cat.toLowerCase().includes(maudauBlockSearch.toLowerCase()))
                  .map(cat => {
                    const mapping = categoryPortalIds[cat] ?? ''
                    const resolvedPortalId = /^\d+$/.test(mapping) ? mapping : (slugToPortalIdClient[mapping] ?? '')
                    const catAttrsForBlock = resolvedPortalId ? (portalIdAttrsMap[resolvedPortalId] ?? []) : []
                    const isBlockExpanded = expandedCatBlocks.has(cat)

                    return (
                      <div key={cat} className="border border-zinc-800/60 rounded-lg overflow-hidden">
                        {/* Category row */}
                        <div className="grid grid-cols-[1fr_1fr_56px] gap-2 px-2 py-1.5 items-center bg-zinc-900">
                          {/* Site category */}
                          <span className="text-xs text-zinc-300 truncate">{cat}</span>

                          {/* MauDau category dropdown */}
                          <MauDauCatDropdown
                            value={mapping}
                            maudauCategories={maudauCategories}
                            onChange={v => setCategoryPortalIds(prev => ({ ...prev, [cat]: v }))}
                          />

                          {/* Expand attrs button */}
                          <button
                            type="button"
                            disabled={catAttrsForBlock.length === 0}
                            onClick={() => setExpandedCatBlocks(prev => {
                              const next = new Set(prev)
                              next.has(cat) ? next.delete(cat) : next.add(cat)
                              return next
                            })}
                            className={`text-center text-[10px] px-1.5 py-1 rounded border transition-colors ${
                              catAttrsForBlock.length === 0
                                ? 'border-zinc-800 text-zinc-700 cursor-not-allowed'
                                : isBlockExpanded
                                  ? 'bg-purple-900/40 border-purple-700 text-purple-300'
                                  : 'border-zinc-700 text-zinc-500 hover:border-purple-600 hover:text-purple-400'
                            }`}
                            title={catAttrsForBlock.length === 0 ? 'Виберіть категорію MauDau' : `${catAttrsForBlock.length} атрибутів`}
                          >
                            {catAttrsForBlock.length > 0
                              ? (isBlockExpanded ? `▲${catAttrsForBlock.length}` : `▼${catAttrsForBlock.length}`)
                              : '—'}
                          </button>
                        </div>

                        {/* Expanded: attributes for this category (mass-fill) */}
                        {isBlockExpanded && catAttrsForBlock.length > 0 && (
                          <div className="px-3 py-3 bg-zinc-800/30 border-t border-zinc-800 space-y-2">
                            <div className="flex items-center justify-between mb-1">
                              <p className="text-[10px] text-zinc-500">
                                Заповнені значення застосуються до всіх активних товарів у категорії «{cat}»
                              </p>
                              <label className="flex items-center gap-1 cursor-pointer shrink-0 ml-2" title="Завантажити шаблон MauDau для синхронізації slugів характеристик">
                                <span className="text-[10px] text-purple-400 hover:text-purple-300 whitespace-nowrap">📄 Шаблон MauDau</span>
                                <input
                                  type="file"
                                  accept=".xlsx"
                                  className="hidden"
                                  onChange={async e => {
                                    const f = e.target.files?.[0]
                                    if (!f || !resolvedPortalId) return
                                    e.target.value = ''
                                    setAttrTemplateStatus(s => ({ ...s, [resolvedPortalId]: '⏳' }))
                                    try {
                                      const fd = new FormData()
                                      fd.append('portal_id', resolvedPortalId)
                                      fd.append('file', f)
                                      const res = await fetch('/api/maudau/upload-attr-template', { method: 'POST', body: fd })
                                      const data = await res.json()
                                      if (!res.ok) throw new Error(data.error ?? 'Помилка')
                                      const msg = data.unmatched?.length
                                        ? `✓ ${data.matched}/${data.total} (не зіставлено: ${data.unmatched.join(', ')})`
                                        : `✓ ${data.matched}/${data.total} slugів`
                                      setAttrTemplateStatus(s => ({ ...s, [resolvedPortalId]: msg }))
                                    } catch (err: any) {
                                      setAttrTemplateStatus(s => ({ ...s, [resolvedPortalId]: `✗ ${err.message}` }))
                                    }
                                  }}
                                />
                              </label>
                            </div>
                            {attrTemplateStatus[resolvedPortalId] && (
                              <p className={`text-[10px] ${attrTemplateStatus[resolvedPortalId].startsWith('✓') ? 'text-green-400' : attrTemplateStatus[resolvedPortalId] === '⏳' ? 'text-zinc-400' : 'text-red-400'}`}>
                                {attrTemplateStatus[resolvedPortalId]}
                              </p>
                            )}
                            {catAttrsForBlock.map(attr => {
                              const productWithCat = allProducts.find(p =>
                                p.category_name === cat && overrides[p.id]?.is_active
                              )
                              const sampleVal = productWithCat
                                ? (overrides[productWithCat.id]?.custom_params?.[attr.name] ?? '')
                                : ''
                              const hasDropdown = (attr.values ?? []).length > 0

                              return (
                                <div key={attr.name} className="flex items-center gap-2">
                                  <span className="w-36 shrink-0 text-[11px] text-zinc-400 truncate">{attr.name}</span>
                                  <span className="text-zinc-600 text-xs shrink-0">:</span>
                                  {hasDropdown ? (
                                    <div className="flex-1">
                                      <SearchableSelect
                                        value={sampleVal}
                                        options={attr.values.map((v: string) => ({ value: v, label: v.replace(/<[^>]+>/g, '').trim() }))}
                                        onChange={v => setCatDefaultAndApply(cat, resolvedPortalId, attr.name, v)}
                                        placeholder="— Обрати —"
                                        emptyLabel="— прибрати —"
                                        accentColor="purple"
                                      />
                                    </div>
                                  ) : (
                                    <input
                                      type="text"
                                      defaultValue={sampleVal}
                                      onBlur={e => {
                                        if (e.target.value !== sampleVal) {
                                          setCatDefaultAndApply(cat, resolvedPortalId, attr.name, e.target.value)
                                        }
                                      }}
                                      className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-1 text-[11px] text-white focus:outline-none focus:border-purple-500"
                                      placeholder="Значення для всіх товарів..."
                                    />
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                {activeCategories.filter(cat => !maudauBlockSearch || cat.toLowerCase().includes(maudauBlockSearch.toLowerCase())).length === 0 && (
                  <p className="text-xs text-zinc-600 py-2">Нічого не знайдено</p>
                )}
              </div>
            </>
          )}
          {maudauCategories.length === 0 && !maudauCatsLoading && !maudauCatsError && (
            <p className="text-xs text-zinc-600 mt-3">
              Категорії не знайдено — натисніть «Завантажити всі категорії MauDau».
            </p>
          )}
        </div>
      )}


    </div>
  )
}

function FeedAccessStats({ feedId }: { feedId: string }) {
  const [logs, setLogs] = useState<{ accessed_at: string; offers_count: number | null; errors_count: number | null; errors: string[] | null; auto_synced: boolean }[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [expandedLog, setExpandedLog] = useState<number | null>(null)

  useEffect(() => {
    fetch(`/api/feeds/${feedId}/access-logs`)
      .then(r => r.json())
      .then(d => setLogs(d.logs ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [feedId])

  if (loading) return null

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
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      {/* Compact header row — same height as settings bar */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex flex-wrap items-center gap-4 px-4 py-3 hover:bg-zinc-800/40 transition-colors text-left"
      >
        <span className="text-xs font-medium text-zinc-300 whitespace-nowrap">📊 Статистика звернень</span>
        <div className="w-px h-4 bg-zinc-700 hidden sm:block" />
        <span className="text-xs text-zinc-500 whitespace-nowrap">
          За 24 год: <span className="text-white font-medium">{countDay}</span>
        </span>
        <span className="text-xs text-zinc-500 whitespace-nowrap">
          За 7 днів: <span className="text-white font-medium">{countWeek}</span>
        </span>
        {totalErrors > 0 && (
          <span className="text-xs text-red-400 whitespace-nowrap">⚠ {totalErrors} помилок</span>
        )}
        {logs.length === 0 && (
          <span className="text-xs text-zinc-600">Фід ще не відкривався</span>
        )}
        <span className="ml-auto text-zinc-600 text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {/* Dropdown: last 10 requests */}
      {open && logs.length > 0 && (
        <div className="border-t border-zinc-800 px-4 py-3">
          <div className="text-[10px] text-zinc-600 uppercase tracking-wide mb-2">Останні 10 звернень</div>
          <div className="space-y-0.5">
            {logs.slice(0, 10).map((l, i) => (
              <div key={i} className="border-b border-zinc-800/60 last:border-0">
                <div className="flex items-center gap-3 text-xs py-1.5">
                  <span className="font-mono text-zinc-400 w-28 shrink-0">{fmt(l.accessed_at)}</span>
                  <span className="text-zinc-300">{l.offers_count ?? '?'} товарів</span>
                  {(l.errors_count ?? 0) > 0 ? (
                    <button
                      onClick={e => { e.stopPropagation(); setExpandedLog(expandedLog === i ? null : i) }}
                      className="text-red-400 hover:text-red-300 transition-colors"
                    >
                      ⚠ {l.errors_count} помилок {expandedLog === i ? '▲' : '▼'}
                    </button>
                  ) : (
                    <span className="text-emerald-600 text-[10px]">✓ OK</span>
                  )}
                  {l.auto_synced && (
                    <span className="text-emerald-500 ml-auto text-[10px]">🔄 WC синк</span>
                  )}
                </div>
                {expandedLog === i && (l.errors ?? []).length > 0 && (
                  <div className="mb-2 ml-28 bg-red-950/30 border border-red-900/40 rounded p-2 space-y-0.5">
                    {(l.errors ?? []).map((e, j) => (
                      <div key={j} className="text-[11px] text-red-300 font-mono">{e}</div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

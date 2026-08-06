'use client'
import { useState, useEffect, useMemo, useTransition, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'

type WcCategory = { id: number; name: string; slug: string; parent: number }

type ProductImage = { src: string; alt: string; name: string; id?: number }

type Product = {
  id: string
  name: string
  description: string | null
  sku: string | null
  price: number
  price_old: number | null
  stock: number | null
  status: string
  images: string[]
  external_id: string | null
  category_name: string | null
  categories: string[] | null
  brand: string | null
  attributes: Record<string, string> | null
  unit: string | null
  vendor: string | null
}

type Props = {
  allProducts: Product[]
  warehouseName: string
  readOnly: boolean
}

type EditState = {
  name: string
  description: string
  short_description: string
  categoryIds: number[]
  min: string
  step: string
  images: ProductImage[]
}

const PER_PAGE = 50
type SortKey = 'name' | 'price' | 'stock' | 'status' | 'category_name' | 'brand'

function calcPer100g(price: number, attrs: Record<string, string> | null): number | null {
  const unit = (attrs?.['Одиниця'] ?? '').toLowerCase()
  const min = parseFloat(attrs?.['Мін'] ?? '0') || 0
  if (unit === 'кг' || unit === 'л') return Math.round(price / 10 * 10) / 10
  if ((unit === 'г' || unit === 'мл') && min > 0) return Math.round(price / min * 100 * 10) / 10
  return null
}

function isWeightUnit(attrs: Record<string, string> | null): boolean {
  const u = (attrs?.['Одиниця'] ?? '').toLowerCase()
  return ['кг', 'г', 'мл', 'л'].includes(u)
}

function getSaleCategories(products: Product[]): string[] {
  const set = new Set<string>()
  for (const p of products) {
    for (const cat of p.categories ?? []) {
      if (cat.toLowerCase().includes('акці')) set.add(cat)
    }
  }
  return [...set].sort()
}

function getProductSaleCats(p: Product, saleCats: Set<string>): string[] {
  return (p.categories ?? []).filter(c => saleCats.has(c))
}

function filenameFromUrl(url: string) {
  return url.split('/').pop()?.split('?')[0] ?? ''
}

function htmlToText(html: string): string {
  return html
    .replace(/<\/p>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function textToHtml(text: string): string {
  if (!text.trim()) return ''
  return text.split(/\n\n+/).map(p => `<p>${p.replace(/\n/g, '<br/>')}</p>`).join('')
}

// ─── Category picker (hierarchical) ────────────────────────────────
function CategoryPicker({
  selected, onChange, allCats,
}: { selected: number[]; onChange: (ids: number[]) => void; allCats: WcCategory[] }) {
  const [search, setSearch] = useState('')

  const toggle = (id: number) => {
    if (selected.includes(id)) onChange(selected.filter(i => i !== id))
    else onChange([...selected, id])
  }

  // Build tree
  const roots = allCats.filter(c => c.parent === 0)
  const children = (parentId: number) => allCats.filter(c => c.parent === parentId)

  const matchesSearch = (cat: WcCategory): boolean => {
    if (!search) return true
    if (cat.name.toLowerCase().includes(search.toLowerCase())) return true
    return children(cat.id).some(matchesSearch)
  }

  const renderCat = (cat: WcCategory, depth = 0): React.ReactNode => {
    if (!matchesSearch(cat)) return null
    const isSelected = selected.includes(cat.id)
    const kids = children(cat.id)
    return (
      <div key={cat.id}>
        <label
          className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-zinc-800 transition-colors ${isSelected ? 'text-emerald-400' : 'text-zinc-300'}`}
          style={{ paddingLeft: `${12 + depth * 20}px` }}
        >
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => toggle(cat.id)}
            className="accent-emerald-500 shrink-0"
          />
          <span className="text-sm">{cat.name}</span>
        </label>
        {kids.map(k => renderCat(k, depth + 1))}
      </div>
    )
  }

  return (
    <div className="border border-zinc-700 rounded-lg overflow-hidden">
      <div className="p-2 border-b border-zinc-700">
        <input
          type="text"
          placeholder="Пошук категорій..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full bg-zinc-800 text-sm text-white px-3 py-1.5 rounded border border-zinc-700 focus:outline-none focus:border-zinc-500"
        />
      </div>
      <div className="max-h-56 overflow-y-auto py-1">
        {roots.map(r => renderCat(r))}
        {roots.length === 0 && <p className="text-xs text-zinc-600 px-3 py-2">Завантаження...</p>}
      </div>
    </div>
  )
}

// ─── Edit panel ────────────────────────────────────────────────────
function EditPanel({
  product, allCats, onSaved,
}: { product: Product; allCats: WcCategory[]; onSaved: () => void }) {
  const [edit, setEdit] = useState<EditState | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load real WC data
  useEffect(() => {
    fetch(`/api/wc/products/${product.id}`)
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`); return d })
      .then(data => {
        const minAttr = data.attributes?.find((a: { name: string }) => a.name === 'Мін')
        const stepAttr = data.attributes?.find((a: { name: string }) => a.name === 'Вага') ??
                         data.attributes?.find((a: { name: string }) => a.name === 'Крок')
        const supabaseAttrs = product.attributes
        const minVal = minAttr?.options?.[0] ?? supabaseAttrs?.['Мін'] ?? ''
        const stepVal = stepAttr?.options?.[0] ?? supabaseAttrs?.['Вага'] ?? supabaseAttrs?.['Крок'] ?? ''
        const descText = htmlToText(data.short_description ?? data.description ?? '')
        setEdit({
          name: data.name ?? product.name,
          description: data.description ?? '',
          short_description: descText,
          categoryIds: (data.categories ?? []).map((c: { id: number }) => c.id),
          min: minVal,
          step: stepVal,
          images: (data.images ?? []).map((img: ProductImage) => ({
            id: img.id,
            src: img.src,
            alt: img.alt ?? '',
            name: img.name ?? filenameFromUrl(img.src),
          })),
        })
        setLoading(false)
      })
      .catch((e: Error) => {
        setError(`Не вдалось завантажити дані з WC: ${e.message}`)
        // Fallback to Supabase data
        const attrs = product.attributes
        const initImages: ProductImage[] = (product.images ?? []).map(url => {
          const fn = filenameFromUrl(url)
          return { src: url, alt: '', name: fn }
        })
        const initCatIds = (product.categories ?? [])
          .map(name => allCats.find(c => c.name === name)?.id)
          .filter((id): id is number => id !== undefined)
        setEdit({
          name: product.name,
          description: product.description ?? '',
          short_description: htmlToText(product.description ?? ''),
          categoryIds: initCatIds,
          min: attrs?.['Мін'] ?? '',
          step: attrs?.['Вага'] ?? attrs?.['Крок'] ?? '',
          images: initImages,
        })
        setLoading(false)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const updateImg = (i: number, field: 'alt' | 'name', val: string) => {
    setEdit(e => e ? ({ ...e, images: e.images.map((img, idx) => idx === i ? { ...img, [field]: val } : img) }) : e)
  }

  const handleSave = async () => {
    if (!edit) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/wc/products/${product.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: edit.name,
          description: textToHtml(edit.short_description),
          short_description: textToHtml(edit.short_description),
          categories: edit.categoryIds,
          min: edit.min || undefined,
          step: edit.step || undefined,
          images: edit.images.map(img => ({ id: img.id, src: img.src, alt: img.alt, name: img.name })),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Помилка')
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Невідома помилка')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-4 pt-4 border-t border-zinc-700/50 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">Редагування → WooCommerce</p>
        <div className="flex items-center gap-2">
          {error && <span className="text-xs text-red-400 max-w-xs truncate" title={error}>{error.replace(/<[^>]+>/g, '').slice(0, 120)}</span>}
          {saved && <span className="text-xs text-emerald-400">✓ Збережено на сайті</span>}
          <button
            onClick={handleSave}
            disabled={saving || loading || !edit}
            className="px-4 py-1.5 bg-red-700 hover:bg-red-600 text-white text-sm rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {saving ? <span className="animate-spin inline-block">⟳</span> : '↑'}
            {saving ? 'Зберігаємо...' : 'Зберегти на сайт'}
          </button>
        </div>
      </div>

      {loading || !edit ? (
        <div className="text-xs text-zinc-600 py-4 text-center">Завантаження даних з сайту...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Left */}
          <div className="space-y-3">
            <div>
              <label className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1 block">Назва</label>
              <input
                type="text"
                value={edit.name}
                onChange={e => setEdit(s => s ? ({ ...s, name: e.target.value }) : s)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
              />
            </div>

            <div>
              <label className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1 block">Опис</label>
              <textarea
                value={edit.short_description}
                onChange={e => setEdit(s => s ? ({ ...s, short_description: e.target.value, description: e.target.value }) : s)}
                rows={6}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500 resize-y font-mono"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1 block">Мінімальне значення</label>
                <input
                  type="text"
                  value={edit.min}
                  onChange={e => setEdit(s => s ? ({ ...s, min: e.target.value }) : s)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
                />
              </div>
              <div>
                <label className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1 block">Крок</label>
                <input
                  type="text"
                  value={edit.step}
                  onChange={e => setEdit(s => s ? ({ ...s, step: e.target.value }) : s)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1 block">
                Категорії{edit.categoryIds.length > 0 && <span className="ml-1 text-emerald-500">({edit.categoryIds.length})</span>}
              </label>
              {edit.categoryIds.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {edit.categoryIds.map(id => {
                    const cat = allCats.find(c => c.id === id)
                    return cat ? (
                      <span key={id} className="text-[10px] px-2 py-0.5 bg-zinc-700 text-zinc-300 rounded-full flex items-center gap-1">
                        {cat.name}
                        <button onClick={() => setEdit(s => s ? ({ ...s, categoryIds: s.categoryIds.filter(i => i !== id) }) : s)} className="text-zinc-500 hover:text-red-400 leading-none">×</button>
                      </span>
                    ) : null
                  })}
                </div>
              )}
              {allCats.length === 0
                ? <p className="text-xs text-zinc-600">Завантаження категорій...</p>
                : <CategoryPicker selected={edit.categoryIds} onChange={ids => setEdit(s => s ? ({ ...s, categoryIds: ids }) : s)} allCats={allCats} />
              }
            </div>
          </div>

          {/* Right: images */}
          <div>
            <label className="text-[10px] text-zinc-500 uppercase tracking-wide mb-2 block">
              Фото — Alt текст та назва файлу
            </label>
            {edit.images.length === 0 && <p className="text-xs text-zinc-700">Немає фото</p>}
            <div className="space-y-3">
              {edit.images.map((img, i) => (
                <div key={img.id ?? i} className="flex gap-3 items-start">
                  <a href={img.src} target="_blank" rel="noopener noreferrer" className="shrink-0">
                    <img src={img.src} alt={img.alt} className="w-16 h-16 object-cover rounded-lg bg-zinc-800 hover:opacity-80" loading="lazy" />
                  </a>
                  <div className="flex-1 space-y-1.5 min-w-0">
                    <div>
                      <label className="text-[9px] text-zinc-600 uppercase">Alt текст</label>
                      <input
                        type="text"
                        value={img.alt}
                        onChange={e => updateImg(i, 'alt', e.target.value)}
                        className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-zinc-500"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] text-zinc-600 uppercase">Назва файлу</label>
                      <input
                        type="text"
                        value={img.name}
                        onChange={e => updateImg(i, 'name', e.target.value)}
                        className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-zinc-500"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────
export default function ProductsClient({ allProducts, warehouseName, readOnly }: Props) {
  const router = useRouter()
  const [syncing, setSyncing] = useState(false)
  const [, startTransition] = useTransition()

  const [search, setSearch] = useState('')
  const [filterInStock, setFilterInStock] = useState(false)
  const [filterOutStock, setFilterOutStock] = useState(false)
  const [filterWarehouse, setFilterWarehouse] = useState(false)
  const [filterStatus, setFilterStatus] = useState<'active' | 'inactive' | null>('active')
  const [filterSale, setFilterSale] = useState(false)
  const [filterSaleCat, setFilterSaleCat] = useState<string | null>(null)
  const [filterNoSaleCat, setFilterNoSaleCat] = useState(false)
  const [filterUnit, setFilterUnit] = useState<'weight' | 'piece' | null>(null)

  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(1)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // WC categories — loaded once lazily when first product is expanded
  const [allCats, setAllCats] = useState<WcCategory[]>([])
  const catsLoaded = useRef(false)

  const loadCats = useCallback(async () => {
    if (catsLoaded.current) return
    catsLoaded.current = true
    try {
      const res = await fetch('/api/wc/categories')
      if (res.ok) setAllCats(await res.json())
    } catch { /* ignore */ }
  }, [])

  const saleCategories = useMemo(() => getSaleCategories(allProducts), [allProducts])
  const saleCatSet = useMemo(() => new Set(saleCategories), [saleCategories])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
    setPage(1)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setFilter = useCallback((setter: (v: any) => void, val: any) => {
    setter(val)
    setPage(1)
  }, [])

  const filteredProducts = useMemo(() => {
    let list = allProducts
    if (filterStatus === 'active') list = list.filter(p => p.status === 'active')
    else if (filterStatus === 'inactive') list = list.filter(p => p.status !== 'active')
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(p => p.name.toLowerCase().includes(q) || (p.sku ?? '').toLowerCase().includes(q))
    }
    if (filterInStock) list = list.filter(p => p.stock !== null && p.stock > 0)
    if (filterOutStock) list = list.filter(p => p.stock !== null && p.stock <= 0)
    if (filterWarehouse) list = list.filter(p => p.stock !== null)
    if (filterSale) list = list.filter(p => p.price_old != null)
    if (filterSaleCat) list = list.filter(p => (p.categories ?? []).includes(filterSaleCat))
    if (filterNoSaleCat) list = list.filter(p => p.price_old != null && getProductSaleCats(p, saleCatSet).length === 0)
    if (filterUnit === 'weight') list = list.filter(p => isWeightUnit(p.attributes))
    if (filterUnit === 'piece') list = list.filter(p => !isWeightUnit(p.attributes))
    list = [...list].sort((a, b) => {
      let va: string | number = ''
      let vb: string | number = ''
      if (sortKey === 'name') { va = a.name; vb = b.name }
      else if (sortKey === 'price') { va = a.price; vb = b.price }
      else if (sortKey === 'stock') { va = a.stock ?? -1; vb = b.stock ?? -1 }
      else if (sortKey === 'status') { va = a.status; vb = b.status }
      else if (sortKey === 'category_name') { va = a.category_name ?? ''; vb = b.category_name ?? '' }
      else if (sortKey === 'brand') { va = a.brand ?? ''; vb = b.brand ?? '' }
      const cmp = typeof va === 'number' ? (va as number) - (vb as number) : (va as string).localeCompare(vb as string, 'uk')
      return sortDir === 'asc' ? cmp : -cmp
    })
    return list
  }, [allProducts, search, filterStatus, filterInStock, filterOutStock, filterWarehouse, filterSale, filterSaleCat, filterNoSaleCat, filterUnit, saleCatSet, sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PER_PAGE))
  const paginated = filteredProducts.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  const SortBtn = ({ col, label, className = '' }: { col: SortKey; label: string; className?: string }) => (
    <button onClick={() => handleSort(col)} className={`text-xs text-zinc-500 uppercase tracking-wide flex items-center gap-1 hover:text-zinc-300 transition-colors ${className}`}>
      {label}{sortKey === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ' ↕'}
    </button>
  )

  const FilterBtn = ({ active, onClick, children, color = 'zinc' }: { active: boolean; onClick: () => void; children: React.ReactNode; color?: 'zinc' | 'emerald' | 'red' | 'amber' | 'blue' }) => {
    const activeClass = { zinc: 'bg-zinc-600 border-zinc-500 text-white', emerald: 'bg-emerald-700 border-emerald-700 text-white', red: 'bg-red-800 border-red-700 text-white', amber: 'bg-amber-700 border-amber-600 text-white', blue: 'bg-blue-800 border-blue-700 text-white' }[color]
    return (
      <button onClick={onClick} className={`text-xs px-3 py-1.5 rounded-lg border transition-colors whitespace-nowrap ${active ? activeClass : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-500'}`}>{children}</button>
    )
  }

  const handleSync = async () => {
    setSyncing(true)
    try {
      const res = await fetch('/api/sync/woocommerce', { method: 'POST' })
      const data = await res.json()
      if (data.skipped) alert(`⏳ ${data.reason}`)
      else if (data.success) {
        startTransition(() => router.refresh())
        const parts = [`✅ Синхронізовано: ${data.synced} товарів`]
        if (data.deactivated > 0) parts.push(`⚠️ Деактивовано: ${data.deactivated}`)
        alert(parts.join('\n'))
      }
    } catch { alert('❌ Помилка синхронізації') }
    finally { setSyncing(false) }
  }

  return (
    <div className="w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Товари</h1>
        <p className="text-zinc-500 text-sm mt-1">Каталог синхронізований з WooCommerce</p>
      </div>

      <div className="mb-4 space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-sm">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">🔍</span>
            <input type="text" placeholder="Пошук товарів..." value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-red-500 transition-colors" />
          </div>
          <div className="text-xs text-zinc-500">{filteredProducts.length} товарів</div>
          {!readOnly && (
            <button onClick={handleSync} disabled={syncing} className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-sm text-zinc-300 transition-colors disabled:opacity-50">
              <span className={syncing ? 'animate-spin inline-block' : ''}>🔄</span>
              {syncing ? 'Синхронізація...' : 'Синк з WC'}
            </button>
          )}
          <div className="ml-auto">
            <FilterBtn active={filterWarehouse} onClick={() => setFilter(setFilterWarehouse, !filterWarehouse)} color="zinc">🏭 {warehouseName}</FilterBtn>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <FilterBtn active={filterInStock} onClick={() => { setFilter(setFilterInStock, !filterInStock); setFilter(setFilterOutStock, false) }} color="emerald">✓ В наявності</FilterBtn>
          <FilterBtn active={filterOutStock} onClick={() => { setFilter(setFilterOutStock, !filterOutStock); setFilter(setFilterInStock, false) }} color="red">✕ Не в наявності</FilterBtn>
          <FilterBtn active={filterStatus === 'active'} onClick={() => setFilter(setFilterStatus, filterStatus === 'active' ? null : 'active')} color="emerald">Активний</FilterBtn>
          <FilterBtn active={filterStatus === 'inactive'} onClick={() => setFilter(setFilterStatus, filterStatus === 'inactive' ? null : 'inactive')} color="zinc">Неактивний</FilterBtn>
          <FilterBtn active={filterUnit === 'piece'} onClick={() => setFilter(setFilterUnit, filterUnit === 'piece' ? null : 'piece')} color="blue">Штучні (шт)</FilterBtn>
          <FilterBtn active={filterUnit === 'weight'} onClick={() => setFilter(setFilterUnit, filterUnit === 'weight' ? null : 'weight')} color="blue">Вагові (кг/г)</FilterBtn>
          <FilterBtn active={filterSale} onClick={() => setFilter(setFilterSale, !filterSale)} color="amber">% З акцією</FilterBtn>
          <FilterBtn active={filterNoSaleCat} onClick={() => { setFilter(setFilterNoSaleCat, !filterNoSaleCat); setFilter(setFilterSaleCat, null) }} color="amber">Знижка поза акцією</FilterBtn>
          {saleCategories.map(cat => (
            <FilterBtn key={cat} active={filterSaleCat === cat} onClick={() => { setFilter(setFilterSaleCat, filterSaleCat === cat ? null : cat); setFilter(setFilterNoSaleCat, false) }} color="amber">🏷 {cat}</FilterBtn>
          ))}
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="grid gap-3 px-4 py-3 border-b border-zinc-800 bg-zinc-800/50"
          style={{ gridTemplateColumns: '24px 72px 1fr 160px 160px 100px 100px 90px 45px 90px 100px 90px' }}>
          <div />
          <div className="text-xs text-zinc-500 uppercase tracking-wide">Фото</div>
          <SortBtn col="name" label="Назва / Артикул" />
          <SortBtn col="category_name" label="Категорія" />
          <SortBtn col="brand" label="Бренд" />
          <SortBtn col="price" label="Ціна" className="justify-end" />
          <div className="text-xs text-zinc-500 uppercase tracking-wide text-right">Акційна</div>
          <SortBtn col="stock" label="Залишок" className="justify-end" />
          <div className="text-xs text-zinc-500 uppercase tracking-wide text-center">Од.</div>
          <div className="text-xs text-zinc-500 uppercase tracking-wide text-center">Мін.</div>
          <div className="text-xs text-zinc-500 uppercase tracking-wide text-center">Крок</div>
          <SortBtn col="status" label="Статус" className="justify-center" />
        </div>

        <div className="divide-y divide-zinc-800">
          {paginated.length === 0 && (
            <div className="py-16 text-center text-zinc-600">
              {search ? `Нічого не знайдено за запитом "${search}"` : 'Товарів немає'}
            </div>
          )}
          {paginated.map(p => {
            const img = p.images?.[0]
            const noImg = !img
            const noPrice = !p.price || Number(p.price) <= 0
            const stockVal = p.stock
            const zeroStock = stockVal === 0 && p.status === 'active'
            const attrs = p.attributes
            const minVal = attrs?.['Мін'] ?? null
            const stepVal = attrs?.['Вага'] ?? attrs?.['Крок'] ?? null
            const unitBase = attrs?.['Одиниця'] ?? null
            const isExpanded = expandedId === p.id
            const currentPrice = Number(p.price)
            const originalPrice = p.price_old ? Number(p.price_old) : null
            const current100 = calcPer100g(currentPrice, attrs)
            const original100 = originalPrice ? calcPer100g(originalPrice, attrs) : null
            const productSaleCats = getProductSaleCats(p, saleCatSet)
            const siteUrl = p.external_id ? `https://halytska-svizhyna.ua/?p=${p.external_id}` : null

            return (
              <div key={p.id} className="border-b border-zinc-800/60 last:border-0">
                <div
                  className="grid gap-3 px-4 py-2.5 items-center hover:bg-zinc-800/40 transition-colors cursor-pointer"
                  style={{ gridTemplateColumns: '24px 72px 1fr 160px 160px 100px 100px 90px 45px 90px 100px 90px' }}
                  onClick={() => { setExpandedId(isExpanded ? null : p.id); if (!isExpanded) loadCats() }}
                >
                  <div className="text-zinc-600 text-xs select-none">{isExpanded ? '▾' : '▸'}</div>
                  <div className="w-14 h-14 rounded-lg overflow-hidden bg-zinc-800 shrink-0">
                    {img ? <img src={img} alt={p.name} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-zinc-600 text-xl">□</div>}
                  </div>
                  <div className="min-w-0" onClick={e => e.stopPropagation()}>
                    <div className="text-sm text-white leading-snug flex items-start gap-1.5">
                      <button className="text-left line-clamp-2 hover:text-zinc-300" onClick={() => { setExpandedId(isExpanded ? null : p.id); if (!isExpanded) loadCats() }}>{p.name}</button>
                      <div className="flex gap-1 shrink-0 mt-0.5">
                        {noImg && <span title="Немає фото" className="text-amber-500 text-xs">📷</span>}
                        {noPrice && <span title="Немає ціни" className="text-red-500 text-xs">₴</span>}
                      </div>
                    </div>
                    <div className="text-xs text-zinc-600 mt-0.5 font-mono flex items-center gap-2">
                      {p.sku ? <span>{p.sku}</span> : <span className="text-zinc-700">без артикулу</span>}
                      {p.external_id && (
                        <a href={`https://halytska-svizhyna.ua/?p=${p.external_id}`} target="_blank" rel="noopener noreferrer" className="text-zinc-600 hover:text-red-400" onClick={e => e.stopPropagation()}>#{p.external_id} ↗</a>
                      )}
                    </div>
                    {productSaleCats.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {productSaleCats.map(cat => (
                          <span key={cat} className="text-[9px] px-1.5 py-px bg-amber-950/60 border border-amber-800/50 text-amber-400 rounded">🏷 {cat}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-zinc-400 truncate">{p.category_name ?? <span className="text-zinc-700">—</span>}</div>
                  <div className="text-xs truncate">
                    {p.brand === 'Галицька Свіжина' ? <span className="text-red-400">{p.brand}</span> : <span className="text-zinc-300">{p.brand ?? <span className="text-zinc-700">—</span>}</span>}
                  </div>
                  <div className="text-right">
                    {noPrice ? <span className="text-red-500 text-sm">—</span> : (
                      <div>
                        <div className={`text-sm font-semibold ${p.price_old ? 'text-emerald-400' : 'text-white'}`}>
                          {current100 != null ? `${current100} ₴` : `${currentPrice.toLocaleString('uk-UA')} ₴`}
                        </div>
                        {current100 != null && <div className="text-[10px] text-zinc-600">/100{unitBase === 'мл' || unitBase === 'л' ? 'мл' : 'г'}</div>}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    {originalPrice ? (
                      <div>
                        <div className="text-xs text-zinc-500 line-through">{original100 != null ? `${original100} ₴` : `${originalPrice.toLocaleString('uk-UA')} ₴`}</div>
                        <div className="text-[10px] text-emerald-600 mt-0.5">-{Math.round((1 - currentPrice / originalPrice) * 100)}%</div>
                      </div>
                    ) : <span className="text-xs text-zinc-700">—</span>}
                  </div>
                  <div className={`text-sm text-right font-medium ${zeroStock ? 'text-red-400' : 'text-zinc-300'}`}>
                    {stockVal === null ? <span className="text-zinc-500 text-xs">∞</span> : <>{Number(stockVal).toLocaleString('uk-UA', { maximumFractionDigits: 2 })}{zeroStock && <span className="ml-1 text-xs text-red-400">⚠</span>}</>}
                  </div>
                  <div className="text-xs text-zinc-500 text-center">{unitBase ?? '—'}</div>
                  <div className="text-xs text-center">
                    {minVal ? <span className="text-zinc-400">{minVal}</span> : <span className="text-zinc-700">—</span>}
                  </div>
                  <div className="text-xs text-center">
                    {stepVal ? <span className={stepVal === minVal ? 'text-blue-400' : 'text-amber-400'}>{stepVal}</span> : <span className="text-zinc-700">—</span>}
                  </div>
                  <div className="text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${p.status === 'active' ? 'bg-emerald-950 text-emerald-400' : 'bg-zinc-800 text-zinc-500'}`}>
                      {p.status === 'active' ? 'Актив' : p.status === 'inactive' ? 'Неактив' : p.status}
                    </span>
                  </div>
                </div>

                {isExpanded && (
                  <div className="bg-zinc-800/20 border-t border-zinc-800/60 px-6 py-4">
                    {/* View section */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <div className="space-y-3">
                        <p className="text-[10px] text-zinc-600 uppercase tracking-wider font-medium">Інформація з сайту</p>
                        {siteUrl && (
                          <a href={siteUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-red-400 hover:text-red-300 underline break-all block">🔗 {siteUrl}</a>
                        )}
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                          {([['Категорія', p.category_name], ['Бренд', p.brand], ['Артикул', p.sku], ['Одиниця', p.unit ?? attrs?.['Одиниця']], ['Продавець', p.vendor], ['Статус', p.status], ['External ID', p.external_id]] as [string, string | null | undefined][]).map(([label, val]) => val ? (
                            <div key={label} className="flex gap-2"><span className="text-zinc-500 shrink-0">{label}:</span><span className="text-zinc-300 break-all">{val}</span></div>
                          ) : null)}
                        </div>
                        {(p.categories ?? []).length > 0 && (
                          <div>
                            <p className="text-[10px] text-zinc-600 mb-1">Категорії:</p>
                            <div className="flex flex-wrap gap-1">
                              {(p.categories ?? []).map(cat => (
                                <span key={cat} className={`text-[10px] px-1.5 py-0.5 rounded border ${saleCatSet.has(cat) ? 'bg-amber-950/60 border-amber-800/50 text-amber-400' : 'bg-zinc-800 border-zinc-700 text-zinc-400'}`}>{cat}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        <div>
                          <p className="text-[10px] text-zinc-600 mb-1">Ціни:</p>
                          <div className="flex gap-4 text-xs">
                            <div><span className="text-zinc-500">Поточна: </span><span className={p.price_old ? 'text-emerald-400' : 'text-white'}>{currentPrice.toLocaleString('uk-UA')} ₴{current100 != null && <span className="text-zinc-500 ml-1">({current100} ₴/100г)</span>}</span></div>
                            {originalPrice && <div><span className="text-zinc-500">До знижки: </span><span className="text-zinc-400 line-through">{originalPrice.toLocaleString('uk-UA')} ₴{original100 != null && <span className="text-zinc-500 ml-1">({original100} ₴/100г)</span>}</span></div>}
                          </div>
                        </div>
                        {p.description && (
                          <div>
                            <p className="text-[10px] text-zinc-600 mb-1">Опис:</p>
                            <div className="text-xs text-zinc-400 leading-relaxed max-h-24 overflow-y-auto [&_p]:mb-1 [&_ul]:list-disc [&_ul]:pl-4" dangerouslySetInnerHTML={{ __html: p.description }} />
                          </div>
                        )}
                        {attrs && Object.keys(attrs).length > 0 && (
                          <div>
                            <p className="text-[10px] text-zinc-600 mb-1">Атрибути:</p>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                              {Object.entries(attrs).map(([k, v]) => (
                                <div key={k} className="flex gap-2 text-xs"><span className="text-zinc-500 shrink-0 w-24 truncate">{k}:</span><span className="text-zinc-300 break-all">{String(v)}</span></div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                      <div>
                        <p className="text-[10px] text-zinc-600 uppercase tracking-wider font-medium mb-2">Фото ({p.images?.length ?? 0})</p>
                        {(p.images ?? []).length === 0 ? <p className="text-xs text-zinc-700">Немає фото</p> : (
                          <div className="grid grid-cols-3 gap-2">
                            {(p.images ?? []).map((url, i) => {
                              const filename = filenameFromUrl(url)
                              const altGuess = filename.replace(/[-_]/g, ' ').replace(/\.\w+$/, '') || p.name
                              return (
                                <div key={i} className="space-y-1">
                                  <a href={url} target="_blank" rel="noopener noreferrer">
                                    <img src={url} alt={altGuess} className="w-full aspect-square object-cover rounded-lg bg-zinc-800 hover:opacity-80 transition-opacity" loading="lazy" />
                                  </a>
                                  <div className="text-[9px] text-zinc-600 truncate"><span className="text-zinc-700">alt: </span>{altGuess}</div>
                                  <div className="text-[9px] text-zinc-700 truncate">{filename}</div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Edit panel */}
                    {!readOnly && (
                      <EditPanel
                        product={p}
                        allCats={allCats}
                        onSaved={() => startTransition(() => router.refresh())}
                      />
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <span>{filteredProducts.length} товарів · сторінка {page} з {totalPages}</span>
          <span className="text-zinc-700">{PER_PAGE} на сторінці</span>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button disabled={page === 1} onClick={() => setPage(p => Math.max(1, p - 1))} className="px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg transition-colors disabled:opacity-30">← Попередня</button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(pg => pg === 1 || pg === totalPages || Math.abs(pg - page) <= 2)
              .reduce<(number | '...')[]>((acc, pg, i, arr) => {
                if (i > 0 && pg - (arr[i - 1] as number) > 1) acc.push('...')
                acc.push(pg)
                return acc
              }, [])
              .map((pg, i) => pg === '...'
                ? <span key={`e${i}`} className="text-xs text-zinc-600 px-1">…</span>
                : <button key={pg} onClick={() => setPage(pg as number)} className={`text-xs px-2.5 py-1 rounded border transition-colors ${page === pg ? 'bg-red-700 border-red-700 text-white' : 'bg-zinc-800 hover:bg-zinc-700 border-zinc-700 text-zinc-400'}`}>{pg}</button>
              )
            }
            <button disabled={page === totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))} className="px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg transition-colors disabled:opacity-30">Наступна →</button>
          </div>
        )}
      </div>
    </div>
  )
}

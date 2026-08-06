'use client'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useState, useTransition } from 'react'

type Props = {
  total: number
  readOnly?: boolean
  warehouseName: string
  saleCategories: string[]
}

export default function ProductsToolbar({ total, readOnly, warehouseName, saleCategories }: Props) {
  const router = useRouter()
  const params = useSearchParams()
  const [syncing, setSyncing] = useState(false)
  const [isPending, startTransition] = useTransition()

  const search = params.get('q') ?? ''
  const onSale = params.get('sale') === '1'
  const filterInStock = params.get('instock') === '1'
  const filterOutStock = params.get('outstock') === '1'
  const filterWarehouse = params.get('warehouse') === '1'
  const statusFilter = params.get('status') ?? 'active'
  const activeSaleCat = params.get('salecat') ?? ''

  const navigate = useCallback((updates: Record<string, string | null>) => {
    startTransition(() => {
      const p = new URLSearchParams(params.toString())
      p.delete('page')
      for (const [k, v] of Object.entries(updates)) {
        if (v === null) p.delete(k)
        else p.set(k, v)
      }
      router.replace(`/products?${p.toString()}`)
    })
  }, [params, router])

  const handleSearch = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    navigate({ q: e.target.value || null })
  }, [navigate])

  const toggleParam = (key: string, value: string) => {
    const current = params.get(key)
    navigate({ [key]: current === value ? null : value })
  }

  const handleSync = async () => {
    setSyncing(true)
    try {
      const res = await fetch('/api/sync/woocommerce', { method: 'POST' })
      const data = await res.json()
      if (data.skipped) {
        alert(`⏳ ${data.reason}`)
      } else if (data.success) {
        router.refresh()
        const parts = [`✅ Синхронізовано: ${data.synced} товарів`]
        if (data.deactivated > 0) parts.push(`⚠️ Деактивовано: ${data.deactivated} (видалені з WC)`)
        alert(parts.join('\n'))
      }
    } catch {
      alert('❌ Помилка синхронізації')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="space-y-2">
      {/* Row 1: search + sync */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">🔍</span>
          <input
            type="text"
            placeholder="Пошук товарів..."
            defaultValue={search}
            onChange={handleSearch}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-red-500 transition-colors"
          />
          {isPending && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 text-xs">...</span>
          )}
        </div>
        <div className="text-xs text-zinc-500">{total} товарів</div>
        {!readOnly && (
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-sm text-zinc-300 transition-colors disabled:opacity-50"
          >
            <span className={syncing ? 'animate-spin inline-block' : ''}>🔄</span>
            {syncing ? 'Синхронізація...' : 'Синк з WC'}
          </button>
        )}
      </div>

      {/* Row 2: filters */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Warehouse */}
        <button
          onClick={() => toggleParam('warehouse', '1')}
          className={`text-xs px-3 py-1.5 rounded-lg border transition-colors whitespace-nowrap ${
            filterWarehouse
              ? 'bg-zinc-600 border-zinc-500 text-white'
              : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-500'
          }`}
          title="Товари з відслідковуваним залишком складу"
        >
          🏭 {warehouseName}
        </button>

        {/* In stock */}
        <button
          onClick={() => navigate({ instock: filterInStock ? null : '1', outstock: null })}
          className={`text-xs px-3 py-1.5 rounded-lg border transition-colors whitespace-nowrap ${
            filterInStock
              ? 'bg-emerald-700 border-emerald-700 text-white'
              : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-emerald-700'
          }`}
        >✓ В наявності</button>

        {/* Out of stock */}
        <button
          onClick={() => navigate({ outstock: filterOutStock ? null : '1', instock: null })}
          className={`text-xs px-3 py-1.5 rounded-lg border transition-colors whitespace-nowrap ${
            filterOutStock
              ? 'bg-red-800 border-red-700 text-white'
              : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-red-700'
          }`}
        >✕ Не в наявності</button>

        {/* Active */}
        <button
          onClick={() => navigate({ status: statusFilter === 'active' && !filterInStock && !filterOutStock ? null : 'active' })}
          className={`text-xs px-3 py-1.5 rounded-lg border transition-colors whitespace-nowrap ${
            statusFilter === 'active'
              ? 'bg-emerald-900 border-emerald-700 text-emerald-300'
              : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-emerald-700'
          }`}
        >Активний</button>

        {/* Inactive */}
        <button
          onClick={() => navigate({ status: statusFilter === 'inactive' ? null : 'inactive' })}
          className={`text-xs px-3 py-1.5 rounded-lg border transition-colors whitespace-nowrap ${
            statusFilter === 'inactive'
              ? 'bg-zinc-600 border-zinc-500 text-zinc-200'
              : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-500'
          }`}
        >Неактивний</button>

        {/* Sale (price_old exists) */}
        <button
          onClick={() => navigate({ sale: onSale ? null : '1' })}
          className={`text-xs px-3 py-1.5 rounded-lg border transition-colors whitespace-nowrap ${
            onSale
              ? 'bg-emerald-950 border-emerald-700 text-emerald-400'
              : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200'
          }`}
        >% З акцією</button>

        {/* Sale categories */}
        {saleCategories.map(cat => (
          <button
            key={cat}
            onClick={() => navigate({ salecat: activeSaleCat === cat ? null : cat })}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors whitespace-nowrap ${
              activeSaleCat === cat
                ? 'bg-amber-700 border-amber-600 text-white'
                : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-amber-600'
            }`}
          >🏷 {cat}</button>
        ))}
      </div>
    </div>
  )
}

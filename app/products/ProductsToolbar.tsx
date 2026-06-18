'use client'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useState, useTransition } from 'react'

export default function ProductsToolbar({ total }: { total: number }) {
  const router = useRouter()
  const params = useSearchParams()
  const [syncing, setSyncing] = useState(false)
  const [isPending, startTransition] = useTransition()

  const search = params.get('q') ?? ''

  const handleSearch = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    startTransition(() => {
      const p = new URLSearchParams(params.toString())
      if (val) { p.set('q', val); p.delete('page') }
      else p.delete('q')
      router.replace(`/products?${p.toString()}`)
    })
  }, [params, router])

  const handleSync = async () => {
    setSyncing(true)
    try {
      const res = await fetch('/api/sync/woocommerce', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        router.refresh()
        alert(`✅ Синхронізовано ${data.synced} товарів`)
      }
    } catch {
      alert('❌ Помилка синхронізації')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="flex items-center gap-3">
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
      <button
        onClick={handleSync}
        disabled={syncing}
        className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-sm text-zinc-300 transition-colors disabled:opacity-50"
      >
        <span className={syncing ? 'animate-spin inline-block' : ''}>🔄</span>
        {syncing ? 'Синхронізація...' : 'Синк з WC'}
      </button>
    </div>
  )
}

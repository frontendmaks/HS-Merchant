'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function SyncTrigger() {
  const router = useRouter()
  const [syncing, setSyncing] = useState(false)
  const [last, setLast] = useState<{ synced: number; deactivated: number } | null>(null)

  const handleSync = async () => {
    setSyncing(true)
    setLast(null)
    try {
      const res = await fetch('/api/sync/woocommerce', { method: 'POST' })
      const data = await res.json()
      if (data.skipped) {
        alert(`⏳ ${data.reason}`)
      } else if (data.success) {
        setLast({ synced: data.synced, deactivated: data.deactivated })
        router.refresh()
      }
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="flex items-center gap-3">
      {last && (
        <div className="text-xs text-zinc-500">
          ✅ {last.synced} синкнуто
          {last.deactivated > 0 && <span className="text-amber-400 ml-2">· {last.deactivated} деактивовано</span>}
        </div>
      )}
      <button
        onClick={handleSync}
        disabled={syncing}
        className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
      >
        <span className={syncing ? 'animate-spin inline-block' : ''}>🔄</span>
        {syncing ? 'Синхронізація...' : 'Запустити синк'}
      </button>
    </div>
  )
}

'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'

export default function MarketplaceSyncTrigger() {
  const router = useRouter()
  const [syncing, setSyncing] = useState(false)
  const [last, setLast] = useState<{ maudau: number; rozetka: number } | null>(null)
  const [userName, setUserName] = useState<string>('')

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return
      const { data } = await supabase.from('profiles').select('full_name,email').eq('id', user.id).single()
      setUserName(data?.full_name || data?.email || user.email || '')
    })
  }, [])

  const handleSync = async () => {
    setSyncing(true)
    setLast(null)
    try {
      const res = await fetch('/api/sync/orders-manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggered_by: userName }),
      })
      const data = await res.json()
      if (data.success) {
        setLast({ maudau: data.maudau_synced ?? 0, rozetka: data.rozetka_synced ?? 0 })
        router.refresh()
      } else {
        alert('Помилка синхронізації: ' + (data.error || 'невідома помилка'))
      }
    } catch (e) {
      alert('Помилка: ' + String(e))
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="flex items-center gap-3">
      {last && (
        <div className="text-xs text-zinc-500">
          ✅ MauDau: {last.maudau} · Rozetka: {last.rozetka}
        </div>
      )}
      <button
        onClick={handleSync}
        disabled={syncing}
        className="flex items-center gap-2 px-4 py-2 bg-purple-700 hover:bg-purple-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
      >
        <span className={syncing ? 'animate-spin inline-block' : ''}>🔄</span>
        {syncing ? 'Синхронізація...' : 'Синк замовлень'}
      </button>
    </div>
  )
}

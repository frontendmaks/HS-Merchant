'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Marketplace = { id: string; name: string; slug: string }

export default function NewFeedForm({ marketplaces }: { marketplaces: Marketplace[] }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [marketplaceId, setMarketplaceId] = useState(marketplaces[0]?.id ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleNameChange = (v: string) => {
    setName(v)
    setSlug(
      v.toLowerCase()
        .replace(/[іїєа-яёА-ЯЁ]/g, c => translitMap[c] ?? c)
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
    )
  }

  const handleSubmit = async () => {
    if (!name.trim() || !slug.trim() || !marketplaceId) {
      setError('Заповніть усі поля')
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/feeds/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), slug: slug.trim(), marketplace_id: marketplaceId }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error ?? 'Помилка створення')
      router.push(`/feeds/${data.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-5">
      {/* Name */}
      <div>
        <label className="text-xs text-zinc-500 mb-1.5 block">Назва фіду</label>
        <input
          type="text"
          value={name}
          onChange={e => handleNameChange(e.target.value)}
          placeholder="MauDau фід"
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-red-500"
          autoFocus
        />
      </div>

      {/* Slug */}
      <div>
        <label className="text-xs text-zinc-500 mb-1.5 block">Slug (URL)</label>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-zinc-600 font-mono shrink-0">/api/feeds/</span>
          <input
            type="text"
            value={slug}
            onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
            placeholder="maudau-feed"
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white font-mono placeholder:text-zinc-600 focus:outline-none focus:border-red-500"
          />
        </div>
      </div>

      {/* Marketplace */}
      <div>
        <label className="text-xs text-zinc-500 mb-1.5 block">Маркетплейс</label>
        <select
          value={marketplaceId}
          onChange={e => setMarketplaceId(e.target.value)}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-red-500"
        >
          {marketplaces.map(m => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </div>

      {error && <p className="text-red-400 text-xs">{error}</p>}

      <div className="flex gap-3 pt-1">
        <button
          onClick={() => router.push('/feeds')}
          className="flex-1 px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-sm rounded-lg transition-colors"
        >
          Скасувати
        </button>
        <button
          onClick={handleSubmit}
          disabled={saving || !name.trim() || !slug.trim()}
          className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
        >
          {saving ? 'Створення...' : 'Створити фід →'}
        </button>
      </div>
    </div>
  )
}

const translitMap: Record<string, string> = {
  'а':'a','б':'b','в':'v','г':'h','д':'d','е':'e','є':'ye','ж':'zh','з':'z',
  'и':'y','і':'i','ї':'yi','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o',
  'п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch',
  'ш':'sh','щ':'shch','ь':'','ю':'yu','я':'ya',
}

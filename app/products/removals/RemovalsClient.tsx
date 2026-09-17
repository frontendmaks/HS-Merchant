'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  REMOVAL_STATUS_META, MIN_REMOVAL_REASON, type RemovalStatus,
} from '@/lib/product-removal'

interface Person { full_name: string | null; email: string | null }
interface Item { product_id: string; product_name: string | null }
interface Feed { id: string; name: string }

interface RemovalRequest {
  id: string
  created_by: string
  reason: string
  status: RemovalStatus
  decision_note: string | null
  decided_at: string | null
  created_at: string
  /** Empty means every feed the product is in */
  feed_ids: string[] | null
  author: Person | Person[] | null
  decider: Person | Person[] | null
  items: Item[]
}

interface Product {
  id: string
  name: string
  sku: string | null
  category_name: string | null
  stock: number | null
  status: string | null
  withdrawn_at: string | null
}

const one = (p: Person | Person[] | null): Person | null =>
  Array.isArray(p) ? p[0] ?? null : p
const who = (p: Person | Person[] | null) => {
  const x = one(p)
  return x?.full_name?.trim() || x?.email || '—'
}
const when = (iso: string) =>
  new Date(iso).toLocaleString('uk-UA', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  })

export default function RemovalsClient({ requests, products, feeds, canDecide, meId }: {
  requests: RemovalRequest[]
  products: Product[]
  feeds: Feed[]
  canDecide: boolean
  meId: string | null
}) {
  const feedName = (id: string) => feeds.find(f => f.id === id)?.name ?? id
  const router = useRouter()
  const [editing, setEditing] = useState<RemovalRequest | 'new' | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'open' | 'all'>('open')

  const shown = requests.filter(r => tab === 'all' || r.status === 'pending')
  const pending = requests.filter(r => r.status === 'pending').length
  const withdrawn = products.filter(p => p.withdrawn_at)

  async function decide(id: string, decision: 'approve' | 'reject' | 'cancel') {
    setError('')
    setBusy(id)
    try {
      const res = await fetch(`/api/products/removals/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!data.ok) throw new Error(data.error || 'Не вдалося зберегти рішення')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function restore(productIds: string[]) {
    setError('')
    setBusy('restore')
    try {
      const res = await fetch('/api/products/removals/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productIds }),
      })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!data.ok) throw new Error(data.error || 'Не вдалося повернути в продаж')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">Зняття з продажу</h1>
          <p className="text-zinc-400 text-sm mt-0.5">
            Запити на виведення товарів з асортименту
          </p>
        </div>
        <button
          onClick={() => setEditing('new')}
          className="bg-red-600 hover:bg-red-500 text-white text-sm font-medium
                     px-4 py-2 rounded-lg transition-colors"
        >
          Подати запит
        </button>
      </div>

      {/* What approval actually does, said once and in plain words — the
          difference between this and deleting the offer is the whole design */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
        <p className="text-zinc-400 text-xs leading-relaxed">
          Підтверджений запит <span className="text-white">знімає товар з усіх фідів</span> —
          він перестає туди потрапляти, і залишок стає нульовим. Повернути в продаж можна
          будь-коли: товар стане у ті самі фіди, з яких його зняли.
        </p>
        <p className="text-zinc-600 text-xs leading-relaxed mt-2">
          Врахуйте: маркетплейс читає зниклу пропозицію як «товару більше не існує» і з часом
          гасить картку разом з відгуками й позицією в пошуку. Для товару, який планують
          повернути за тиждень-два, це відчутна втрата.
        </p>
      </div>

      {error && (
        <div className="bg-red-950/40 border border-red-900/60 rounded-lg px-4 py-2.5 text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="flex gap-1">
        {([['open', `На розгляді${pending ? ` (${pending})` : ''}`], ['all', 'Всі']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              tab === key
                ? 'bg-red-600 text-white'
                : 'bg-zinc-800/50 text-zinc-400 hover:text-white hover:bg-zinc-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {shown.length === 0 ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-12 text-center text-zinc-500 text-sm">
            {tab === 'open' ? 'Немає запитів на розгляді' : 'Запитів ще не було'}
          </div>
        ) : shown.map(r => {
          const meta = REMOVAL_STATUS_META[r.status]
          const mine = r.created_by === meId
          return (
            <div key={r.id} id={r.id} className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-zinc-800 flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${meta.badge}`}>
                      {meta.label}
                    </span>
                    <span className="text-zinc-300 text-sm">
                      {r.items.length} {r.items.length === 1 ? 'товар' : 'товарів'}
                    </span>
                    <span className="text-zinc-600 text-xs">
                      {who(r.author)} · {when(r.created_at)}
                    </span>
                    <span className="px-2 py-0.5 rounded text-xs bg-zinc-800 text-zinc-400">
                      {r.feed_ids?.length
                        ? r.feed_ids.map(feedName).join(', ')
                        : 'усі маркетплейси'}
                    </span>
                  </div>
                  <p className="text-white text-sm mt-1.5 whitespace-pre-wrap">{r.reason}</p>
                  {r.decided_at && (
                    <p className="text-zinc-500 text-xs mt-1">
                      {who(r.decider)} · {when(r.decided_at)}
                      {r.decision_note && ` · ${r.decision_note}`}
                    </p>
                  )}
                </div>

                {r.status === 'pending' && (
                  <div className="flex items-center gap-2 shrink-0">
                    {canDecide && (
                      <>
                        <button
                          disabled={busy === r.id}
                          onClick={() => decide(r.id, 'approve')}
                          className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50
                                     text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                        >
                          Підтвердити
                        </button>
                        <button
                          disabled={busy === r.id}
                          onClick={() => decide(r.id, 'reject')}
                          className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50
                                     text-zinc-300 text-xs px-3 py-1.5 rounded-lg transition-colors"
                        >
                          Відхилити
                        </button>
                      </>
                    )}
                    {(mine || canDecide) && (
                      <button
                        onClick={() => setEditing(r)}
                        className="text-zinc-400 hover:text-white text-xs px-2 py-1.5 transition-colors"
                      >
                        Редагувати
                      </button>
                    )}
                    {mine && (
                      <button
                        disabled={busy === r.id}
                        onClick={() => decide(r.id, 'cancel')}
                        className="text-zinc-500 hover:text-white text-xs px-2 py-1.5 transition-colors"
                      >
                        Скасувати
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="divide-y divide-zinc-800/60">
                {r.items.map(i => (
                  <div key={i.product_id} className="px-5 py-2 text-zinc-300 text-xs">
                    {i.product_name ?? i.product_id}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {withdrawn.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-white font-semibold text-sm">Зняті з продажу</h2>
              <p className="text-zinc-500 text-xs mt-0.5">
                {withdrawn.length} — знято з фідів
              </p>
            </div>
          </div>
          <div className="divide-y divide-zinc-800/60">
            {withdrawn.map(p => (
              <div key={p.id} className="px-5 py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-zinc-200 text-xs truncate">{p.name}</div>
                  <div className="text-zinc-600 text-[11px] mt-0.5">{p.category_name ?? '—'}</div>
                </div>
                {canDecide && (
                  <button
                    disabled={busy === 'restore'}
                    onClick={() => restore([p.id])}
                    className="shrink-0 text-emerald-500 hover:text-emerald-400 disabled:opacity-50
                               text-xs px-2 py-1 transition-colors"
                  >
                    Повернути в продаж
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {editing && (
        <Compose
          request={editing === 'new' ? null : editing}
          products={products.filter(p => !p.withdrawn_at || editing !== 'new')}
          feeds={feeds}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); router.refresh() }}
        />
      )}
    </div>
  )
}

/** Picking the products and saying why. */
function Compose({ request, products, feeds, onClose, onDone }: {
  /** Null when raising a new one */
  request: RemovalRequest | null
  products: Product[]
  feeds: Feed[]
  onClose: () => void
  onDone: () => void
}) {
  const [picked, setPicked] = useState<Set<string>>(
    new Set((request?.items ?? []).map(i => i.product_id)),
  )
  // Empty set means every marketplace — the usual case, and the default
  const [pickedFeeds, setPickedFeeds] = useState<Set<string>>(
    new Set(request?.feed_ids ?? []),
  )
  const [query, setQuery] = useState('')
  const [reason, setReason] = useState(request?.reason ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? products.filter(p =>
          p.name.toLowerCase().includes(q) ||
          (p.sku ?? '').toLowerCase().includes(q) ||
          (p.category_name ?? '').toLowerCase().includes(q))
      : products
    // A long catalogue is unusable as one list; searching is how you find one
    return list.slice(0, 200)
  }, [products, query])

  const toggle = (id: string) => setPicked(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const short = reason.trim().length < MIN_REMOVAL_REASON

  async function submit() {
    setError('')
    setSaving(true)
    try {
      const body = {
        productIds: [...picked],
        reason,
        feedIds: pickedFeeds.size === feeds.length ? [] : [...pickedFeeds],
      }
      const res = await fetch(
        request ? `/api/products/removals/${request.id}` : '/api/products/removals',
        {
          method: request ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      )
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!data.ok) throw new Error(data.error || 'Не вдалося подати запит')
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center p-4 overflow-y-auto"
         onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-2xl my-8 flex flex-col"
           style={{ maxHeight: 'calc(100vh - 4rem)' }}
           onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between shrink-0">
          <h2 className="text-white font-semibold">
            {request ? 'Редагувати запит' : 'Запит на зняття з продажу'}
          </h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-xl leading-none">×</button>
        </div>

        <div className="px-5 py-4 border-b border-zinc-800 shrink-0 space-y-3">
          <div>
            <label className="text-zinc-400 text-xs">Причина</label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={2}
              placeholder="Чому товар більше не продається — постачальник, брак, сезон…"
              className="w-full mt-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2
                         text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:border-red-500"
            />
          </div>
          <div>
            <label className="text-zinc-400 text-xs">Звідки прибрати</label>
            <div className="flex flex-wrap gap-2 mt-1.5">
              <button
                type="button"
                onClick={() => setPickedFeeds(new Set())}
                className={`px-3 py-1.5 rounded-lg text-xs transition-colors border ${
                  pickedFeeds.size === 0
                    ? 'bg-red-600 border-red-600 text-white'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white'
                }`}
              >
                Усі маркетплейси
              </button>
              {feeds.map(f => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setPickedFeeds(prev => {
                    const next = new Set(prev)
                    if (next.has(f.id)) next.delete(f.id)
                    else next.add(f.id)
                    return next
                  })}
                  className={`px-3 py-1.5 rounded-lg text-xs transition-colors border ${
                    pickedFeeds.has(f.id)
                      ? 'bg-red-600 border-red-600 text-white'
                      : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white'
                  }`}
                >
                  {f.name}
                </button>
              ))}
            </div>
            {/* Said once: a product off one marketplace keeps selling on the
                rest, and that is the only reason to pick rather than take all */}
            <p className="text-zinc-600 text-xs mt-1.5">
              {pickedFeeds.size === 0
                ? 'Товар прибереться з усіх фідів, у яких він є.'
                : 'На решті маркетплейсів товар продаватиметься далі.'}
            </p>
          </div>

          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Пошук товару за назвою, артикулом або категорією"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2
                       text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:border-red-500"
          />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-zinc-800/60">
          {shown.length === 0 ? (
            <div className="px-5 py-10 text-center text-zinc-600 text-sm">Нічого не знайдено</div>
          ) : shown.map(p => (
            <label key={p.id}
                   className="px-5 py-2.5 flex items-center gap-3 cursor-pointer hover:bg-zinc-800/40">
              <input
                type="checkbox"
                checked={picked.has(p.id)}
                onChange={() => toggle(p.id)}
                className="accent-red-600 shrink-0"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-zinc-200 text-xs truncate">{p.name}</span>
                <span className="block text-zinc-600 text-[11px] mt-0.5 truncate">
                  {p.category_name ?? '—'}
                  {p.status !== 'active' && <span className="text-amber-500"> · немає на сайті</span>}
                </span>
              </span>
            </label>
          ))}
          {products.length > shown.length && !query.trim() && (
            <div className="px-5 py-3 text-center text-zinc-600 text-xs">
              Показано {shown.length} із {products.length} — скористайтеся пошуком
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-zinc-800 shrink-0 flex items-center justify-between gap-3">
          <div className="text-zinc-500 text-xs">
            {picked.size > 0
              ? `Обрано ${picked.size}`
              : 'Оберіть товари'}
            {error && <div className="text-red-400 mt-1">{error}</div>}
          </div>
          <button
            disabled={saving || !picked.size || short}
            onClick={submit}
            title={short ? `Причина — щонайменше ${MIN_REMOVAL_REASON} символів` : undefined}
            className="bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed
                       text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {saving ? 'Збереження…' : request ? 'Зберегти зміни' : 'Подати на підтвердження'}
          </button>
        </div>
      </div>
    </div>
  )
}

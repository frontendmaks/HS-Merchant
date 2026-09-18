'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { advise, VERDICT_META, MATCH_TRUSTED, type Verdict } from '@/lib/price-monitor'

interface Competitor {
  id: string
  name: string
  site_url: string
  search_url: string
  is_active: boolean
  last_checked_at: string | null
  last_error: string | null
}
interface Product {
  id: string; name: string; price: number | null
  category_name: string | null; stock: number | null
}
interface Watch { product_id: string; added_at: string; product: Product | null }
interface Match {
  id: string; product_id: string; competitor_id: string
  competitor_title: string | null; competitor_url: string | null
  price: number | null; similarity: number | null
  status: string; checked_at: string | null; error: string | null
}
interface Snapshot { product_id: string; competitor_id: string; price: number; captured_at: string }

const money = (n: number | null | undefined) =>
  n == null ? '—' : `${Math.round(n).toLocaleString('uk-UA')} ₴`

const when = (iso: string | null) => iso
  ? new Date(iso).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  : 'ще не перевірялось'

export default function PricesClient({ competitors, watches, matches, history }: {
  competitors: Competitor[]
  watches: Watch[]
  matches: Match[]
  history: Snapshot[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'overview' | 'competitors'>('overview')
  const [filter, setFilter] = useState<Verdict | 'all'>('all')
  const [adding, setAdding] = useState(false)

  const byProduct = useMemo(() => {
    const map = new Map<string, Match[]>()
    for (const m of matches) {
      map.set(m.product_id, [...(map.get(m.product_id) ?? []), m])
    }
    return map
  }, [matches])

  /** The previous distinct price we saw, per pair — what "changed" means here. */
  const previous = useMemo(() => {
    const seen = new Map<string, number[]>()
    for (const s of history) {
      const key = `${s.product_id}|${s.competitor_id}`
      seen.set(key, [...(seen.get(key) ?? []), Number(s.price)])
    }
    const out = new Map<string, number>()
    for (const [key, prices] of seen) {
      const older = prices.find(p => p !== prices[0])
      if (older != null) out.set(key, older)
    }
    return out
  }, [history])

  const rows = useMemo(() => watches
    .filter(w => w.product)
    .map(w => {
      const product = w.product!
      const found = (byProduct.get(product.id) ?? []).filter(
        m => m.status !== 'rejected' && m.price != null
          && (m.status === 'confirmed' || Number(m.similarity ?? 0) >= MATCH_TRUSTED),
      )
      const advice = advise(Number(product.price ?? 0), found.map(m => Number(m.price)))
      return {
        product,
        all: byProduct.get(product.id) ?? [],
        used: found,
        advice,
        /** Anything matched but too weak to price against, awaiting a person */
        unsure: (byProduct.get(product.id) ?? []).filter(
          m => m.status === 'auto' && m.price != null
            && Number(m.similarity ?? 0) < MATCH_TRUSTED),
      }
    }), [watches, byProduct])

  const summary = useMemo(() => {
    const count = (v: Verdict) => rows.filter(r => r.advice.verdict === v).length
    const lift = rows
      .filter(r => r.advice.verdict === 'cheap' && r.advice.suggested)
      .reduce((s, r) => s + (r.advice.suggested! - Number(r.product.price ?? 0)), 0)
    return {
      expensive: count('expensive'), cheap: count('cheap'),
      aligned: count('aligned'), noData: count('no_data'),
      unsure: rows.filter(r => r.unsure.length).length,
      lift,
    }
  }, [rows])

  const shown = filter === 'all' ? rows : rows.filter(r => r.advice.verdict === filter)

  async function call(url: string, init: RequestInit, key: string) {
    setBusy(key); setError('')
    try {
      const res = await fetch(url, init)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Помилка')
      router.refresh()
      return data
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }

  const active = competitors.filter(c => c.is_active).length

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-[1400px] mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">Моніторинг цін</h1>
          <p className="text-zinc-400 text-sm mt-0.5">
            {watches.length} позицій · {active} {active === 1 ? 'конкурент' : 'конкурентів'} ·
            {' '}оновлення щодня о 9:30
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => call('/api/prices/run', { method: 'POST' }, 'run')}
            disabled={busy === 'run' || !watches.length || !active}
            className="bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white text-sm
                       font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {busy === 'run' ? 'Перевіряємо…' : 'Перевірити зараз'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-950/50 border border-red-800 rounded-xl px-4 py-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="flex gap-1 border-b border-zinc-800">
        {([['overview', 'Огляд'], ['competitors', `Конкуренти (${competitors.length})`]] as const).map(
          ([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`px-4 py-2 text-sm transition-colors border-b-2 -mb-px ${
                tab === k ? 'border-red-500 text-white' : 'border-transparent text-zinc-500 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
      </div>

      {tab === 'overview' ? (
        <>
          {!competitors.length ? (
            <Empty
              title="Ще немає жодного конкурента"
              body="Додайте сайт конкурента — і вкажіть адресу його пошуку. Порівнювати поки немає з чим."
              action={<button onClick={() => setTab('competitors')}
                className="text-red-400 hover:text-red-300 text-sm">Додати конкурента →</button>}
            />
          ) : !watches.length ? (
            <Empty
              title="Оберіть позиції для моніторингу"
              body="Стежимо лише за тим, що ви обрали. Щоденний обхід усього каталогу — це переважно шум."
              action={<button onClick={() => setAdding(true)}
                className="text-red-400 hover:text-red-300 text-sm">Додати товари →</button>}
            />
          ) : (
            <>
              <Verdicts summary={summary} filter={filter} onFilter={setFilter} />

              {summary.lift > 0 && (
                <div className="bg-amber-950/30 border border-amber-900/60 rounded-xl px-4 py-3">
                  <div className="text-amber-300 text-sm font-medium">
                    Можна підняти ціни на {money(summary.lift)} сумарно
                  </div>
                  <div className="text-zinc-400 text-xs mt-1">
                    По {summary.cheap} позиціях ми дешевші за найдешевшого конкурента більше
                    ніж на 12%. Це віддана маржа, а не перевага — покупець порівнює з ринком,
                    а не з нашою вчорашньою ціною.
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="text-zinc-400 text-sm">
                  {shown.length} {shown.length === 1 ? 'позиція' : 'позицій'}
                  {filter !== 'all' && (
                    <button onClick={() => setFilter('all')}
                      className="text-zinc-500 hover:text-white text-xs ml-2">× скинути фільтр</button>
                  )}
                </div>
                <button
                  onClick={() => setAdding(true)}
                  className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs px-3 py-1.5 rounded-lg transition-colors"
                >
                  + Додати товари
                </button>
              </div>

              <div className="space-y-3">
                {shown.map(row => (
                  <ProductCard
                    key={row.product.id}
                    row={row}
                    competitors={competitors}
                    previous={previous}
                    busy={busy}
                    onMatch={(id, status) => call('/api/prices/match', {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ id, status }),
                    }, id)}
                    onRemove={() => call(
                      `/api/prices/watch?product_id=${row.product.id}`,
                      { method: 'DELETE' }, row.product.id)}
                  />
                ))}
              </div>
            </>
          )}
        </>
      ) : (
        <CompetitorsTab
          competitors={competitors}
          busy={busy}
          onAdd={body => call('/api/prices/competitors', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }, 'add')}
          onToggle={(id, is_active) => call('/api/prices/competitors', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, is_active }),
          }, id)}
          onDelete={id => call(`/api/prices/competitors?id=${id}`, { method: 'DELETE' }, id)}
        />
      )}

      {adding && (
        <AddProducts
          existing={new Set(watches.map(w => w.product_id))}
          onClose={() => setAdding(false)}
          onAdd={async ids => {
            await call('/api/prices/watch', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ productIds: ids }),
            }, 'watch')
            setAdding(false)
          }}
        />
      )}
    </div>
  )
}

function Empty({ title, body, action }: { title: string; body: string; action: React.ReactNode }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-6 py-12 text-center">
      <div className="text-white text-sm font-medium">{title}</div>
      <p className="text-zinc-500 text-xs mt-2 max-w-md mx-auto leading-relaxed">{body}</p>
      <div className="mt-4">{action}</div>
    </div>
  )
}

function Verdicts({ summary, filter, onFilter }: {
  summary: { expensive: number; cheap: number; aligned: number; noData: number; unsure: number }
  filter: Verdict | 'all'
  onFilter: (v: Verdict | 'all') => void
}) {
  const cards: { key: Verdict; value: number; hint: string }[] = [
    { key: 'expensive', value: summary.expensive, hint: 'дорожче ринку на 10%+' },
    { key: 'cheap',     value: summary.cheap,     hint: 'дешевше на 12%+' },
    { key: 'aligned',   value: summary.aligned,   hint: 'різниця в межах норми' },
    { key: 'no_data',   value: summary.noData,    hint: 'конкурента не знайдено' },
  ]
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map(c => {
        const meta = VERDICT_META[c.key]
        const on = filter === c.key
        return (
          <button
            key={c.key}
            onClick={() => onFilter(on ? 'all' : c.key)}
            className={`text-left bg-zinc-900 border rounded-xl px-4 py-3 transition-colors ${
              on ? 'border-red-500' : 'border-zinc-800 hover:border-zinc-700'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
              <span className="text-zinc-400 text-xs">{meta.label}</span>
            </div>
            <div className="text-white text-2xl font-semibold mt-1 tabular-nums">{c.value}</div>
            <div className="text-zinc-600 text-xs mt-0.5">{c.hint}</div>
          </button>
        )
      })}
    </div>
  )
}

interface Row {
  product: Product
  all: Match[]
  used: Match[]
  unsure: Match[]
  advice: ReturnType<typeof advise>
}

function ProductCard({ row, competitors, previous, busy, onMatch, onRemove }: {
  row: Row
  competitors: Competitor[]
  previous: Map<string, number>
  busy: string
  onMatch: (id: string, status: string) => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(false)
  const meta = VERDICT_META[row.advice.verdict]
  const our = Number(row.product.price ?? 0)
  const nameOf = (id: string) => competitors.find(c => c.id === id)?.name ?? '—'

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="px-4 py-3 flex items-start gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${meta.badge}`}>
              {meta.label}
            </span>
            {row.unsure.length > 0 && (
              <span className="px-2 py-0.5 rounded text-xs bg-zinc-800 text-zinc-400">
                {row.unsure.length} під питанням
              </span>
            )}
          </div>
          <div className="text-white text-sm mt-1.5">{row.product.name}</div>
          <div className="text-zinc-500 text-xs mt-0.5">{row.advice.reason}</div>
        </div>

        <div className="flex items-center gap-5 shrink-0">
          <div className="text-right">
            <div className="text-zinc-500 text-xs">Наша</div>
            <div className="text-white text-sm font-semibold tabular-nums">{money(our)}</div>
          </div>
          <div className="text-right">
            <div className="text-zinc-500 text-xs">Найдешевший</div>
            <div className="text-zinc-300 text-sm tabular-nums">{money(row.advice.cheapest)}</div>
          </div>
          {row.advice.suggested != null && (
            <div className="text-right">
              <div className="text-zinc-500 text-xs">Рекомендовано</div>
              <div className={`text-sm font-semibold tabular-nums ${
                row.advice.suggested < our ? 'text-red-400' : 'text-emerald-400'
              }`}>
                {money(row.advice.suggested)}
                <span className="text-zinc-600 text-xs font-normal">
                  {' '}{row.advice.suggested > our ? '+' : ''}
                  {Math.round(row.advice.suggested - our)}
                </span>
              </div>
            </div>
          )}
          <button
            onClick={() => setOpen(!open)}
            className="text-zinc-500 hover:text-white text-xs px-2 py-1 transition-colors"
          >
            {open ? 'Згорнути' : `Деталі (${row.all.length})`}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-zinc-800 bg-zinc-800/20">
          {row.all.length === 0 ? (
            <div className="px-4 py-4 text-zinc-500 text-xs">
              Ще не перевірялось. Наступний обхід — завтра о 9:30.
            </div>
          ) : (
            <div className="divide-y divide-zinc-800/60">
              {row.all.map(m => {
                const was = previous.get(`${m.product_id}|${m.competitor_id}`)
                const score = Number(m.similarity ?? 0)
                const weak = m.status === 'auto' && score < MATCH_TRUSTED
                return (
                  <div key={m.id} className="px-4 py-2.5 flex items-start gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-zinc-300 text-xs font-medium">{nameOf(m.competitor_id)}</span>
                        {m.status === 'confirmed' && (
                          <span className="text-emerald-400 text-xs">✓ підтверджено</span>
                        )}
                        {m.status === 'rejected' && (
                          <span className="text-zinc-600 text-xs">відхилено</span>
                        )}
                        {m.similarity != null && m.status === 'auto' && (
                          <span className={`text-xs ${weak ? 'text-amber-400' : 'text-zinc-600'}`}>
                            збіг {Math.round(score * 100)}%
                          </span>
                        )}
                      </div>
                      {m.error ? (
                        <div className="text-zinc-600 text-xs mt-0.5">{m.error}</div>
                      ) : (
                        <a
                          href={m.competitor_url ?? undefined}
                          target="_blank"
                          rel="noreferrer"
                          className="text-zinc-500 hover:text-zinc-300 text-xs mt-0.5 block truncate transition-colors"
                        >
                          {m.competitor_title ?? '—'}
                        </a>
                      )}
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-white text-sm tabular-nums">{money(m.price)}</div>
                      {was != null && m.price != null && Math.round(was) !== Math.round(Number(m.price)) && (
                        <div className={`text-xs tabular-nums ${
                          Number(m.price) > was ? 'text-red-400' : 'text-emerald-400'
                        }`}>
                          {Number(m.price) > was ? '↑' : '↓'} з {money(was)}
                        </div>
                      )}
                    </div>

                    {m.price != null && m.status !== 'rejected' && (
                      <div className="flex items-center gap-1 shrink-0">
                        {m.status !== 'confirmed' && (
                          <button
                            disabled={busy === m.id}
                            onClick={() => onMatch(m.id, 'confirmed')}
                            className="text-emerald-400 hover:text-emerald-300 text-xs px-2 py-1 transition-colors"
                            title="Це той самий товар"
                          >
                            Це він
                          </button>
                        )}
                        <button
                          disabled={busy === m.id}
                          onClick={() => onMatch(m.id, 'rejected')}
                          className="text-zinc-500 hover:text-red-400 text-xs px-2 py-1 transition-colors"
                          title="Це інший товар — більше не пропонувати"
                        >
                          Не той
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <div className="px-4 py-2 border-t border-zinc-800 flex justify-between items-center">
            <span className="text-zinc-600 text-xs">
              Перевірено: {when(row.all[0]?.checked_at ?? null)}
            </span>
            <button
              onClick={onRemove}
              disabled={busy === row.product.id}
              className="text-zinc-500 hover:text-red-400 text-xs transition-colors"
            >
              Прибрати з моніторингу
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function CompetitorsTab({ competitors, busy, onAdd, onToggle, onDelete }: {
  competitors: Competitor[]
  busy: string
  onAdd: (body: { name: string; site_url: string; search_url: string }) => void
  onToggle: (id: string, is_active: boolean) => void
  onDelete: (id: string) => void
}) {
  const [name, setName] = useState('')
  const [site, setSite] = useState('')
  const [search, setSearch] = useState('')

  const field = 'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-red-500'

  return (
    <div className="space-y-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
        <div className="text-white text-sm font-medium">Додати конкурента</div>

        {/* The search address is the whole trick, so it is explained where it
            is typed rather than in documentation nobody opens */}
        <p className="text-zinc-500 text-xs leading-relaxed">
          Потрібна адреса <span className="text-zinc-300">пошуку</span> на сайті конкурента,
          а не головна сторінка. Знайдіть у них будь-який товар через пошук, скопіюйте адресу
          з рядка браузера і замініть у ній свій запит на <code className="text-red-400">{'{q}'}</code>.
          <br />
          Наприклад: <code className="text-zinc-400">https://shop.ua/search?q=</code>
          <code className="text-red-400">{'{q}'}</code>
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input value={name} onChange={e => setName(e.target.value)}
            placeholder="Назва — напр. Сільпо" className={field} />
          <input value={site} onChange={e => setSite(e.target.value)}
            placeholder="https://shop.ua" className={field} />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="https://shop.ua/search?q={q}" className={field} />
        </div>

        <button
          disabled={busy === 'add' || !name.trim() || !site.trim() || !search.trim()}
          onClick={() => { onAdd({ name, site_url: site, search_url: search }); setName(''); setSite(''); setSearch('') }}
          className="bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white text-sm
                     font-medium px-4 py-2 rounded-lg transition-colors"
        >
          {busy === 'add' ? 'Додається…' : 'Додати'}
        </button>
      </div>

      {competitors.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl divide-y divide-zinc-800">
          {competitors.map(c => (
            <div key={c.id} className="px-4 py-3 flex items-start gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-white text-sm">{c.name}</span>
                  {!c.is_active && (
                    <span className="px-2 py-0.5 rounded text-xs bg-zinc-800 text-zinc-500">
                      вимкнено
                    </span>
                  )}
                </div>
                <a href={c.site_url} target="_blank" rel="noreferrer"
                  className="text-zinc-500 hover:text-zinc-300 text-xs transition-colors">
                  {c.site_url}
                </a>
                <div className="text-zinc-600 text-xs mt-0.5">
                  Перевірено: {when(c.last_checked_at)}
                </div>
                {c.last_error && (
                  <div className="text-amber-400 text-xs mt-1">⚠ {c.last_error}</div>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  disabled={busy === c.id}
                  onClick={() => onToggle(c.id, !c.is_active)}
                  className="text-zinc-400 hover:text-white text-xs px-2 py-1 transition-colors"
                >
                  {c.is_active ? 'Вимкнути' : 'Увімкнути'}
                </button>
                <button
                  disabled={busy === c.id}
                  onClick={() => onDelete(c.id)}
                  className="text-zinc-500 hover:text-red-400 text-xs px-2 py-1 transition-colors"
                >
                  Видалити
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function AddProducts({ existing, onClose, onAdd }: {
  existing: Set<string>
  onClose: () => void
  onAdd: (ids: string[]) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Product[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [searching, setSearching] = useState(false)

  async function search(q: string) {
    setQuery(q)
    if (q.trim().length < 2) { setResults([]); return }
    setSearching(true)
    try {
      const res = await fetch(`/api/prices/search?q=${encodeURIComponent(q)}`)
      const data = await res.json()
      setResults(data.products ?? [])
    } finally {
      setSearching(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-2xl my-8"
        onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
          <h2 className="text-white font-semibold">Додати товари до моніторингу</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-xl leading-none px-1">×</button>
        </div>

        <div className="p-5 space-y-3">
          <input
            autoFocus
            value={query}
            onChange={e => search(e.target.value)}
            placeholder="Пошук товару за назвою"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2
                       text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-red-500"
          />

          <div className="max-h-80 overflow-y-auto space-y-1">
            {searching && <div className="text-zinc-500 text-xs px-1 py-2">Шукаємо…</div>}
            {!searching && query.trim().length >= 2 && !results.length && (
              <div className="text-zinc-500 text-xs px-1 py-2">Нічого не знайдено</div>
            )}
            {results.map(p => {
              const already = existing.has(p.id)
              const on = picked.has(p.id)
              return (
                <button
                  key={p.id}
                  disabled={already}
                  onClick={() => setPicked(prev => {
                    const next = new Set(prev)
                    if (next.has(p.id)) next.delete(p.id); else next.add(p.id)
                    return next
                  })}
                  className={`w-full text-left px-3 py-2 rounded-lg transition-colors border ${
                    already ? 'bg-zinc-800/30 border-transparent opacity-50 cursor-default'
                      : on ? 'bg-red-600/20 border-red-600'
                      : 'bg-zinc-800/40 border-transparent hover:bg-zinc-800'
                  }`}
                >
                  <div className="text-white text-sm">{p.name}</div>
                  <div className="text-zinc-500 text-xs mt-0.5">
                    {money(p.price)} · {p.category_name ?? 'без категорії'}
                    {already && ' · вже в моніторингу'}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        <div className="px-5 py-4 border-t border-zinc-800 flex justify-end gap-2">
          <button onClick={onClose}
            className="text-zinc-400 hover:text-white text-sm px-3 py-2 transition-colors">
            Скасувати
          </button>
          <button
            disabled={!picked.size}
            onClick={() => onAdd([...picked])}
            className="bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white text-sm
                       font-medium px-4 py-2 rounded-lg transition-colors"
          >
            Додати {picked.size > 0 && `(${picked.size})`}
          </button>
        </div>
      </div>
    </div>
  )
}

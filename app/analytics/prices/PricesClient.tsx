'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { contextLabel } from '@/lib/meat-context'
import {
  advise, VERDICT_META, MATCH_MODES, amountLabel, DEFAULT_THRESHOLDS,
  type Verdict, type MatchMode, type Thresholds,
} from '@/lib/price-monitor'

interface Competitor {
  id: string
  name: string
  site_url: string
  search_url: string | null
  city_path: string
  is_active: boolean
  readable: boolean
  last_checked_at: string | null
  last_error: string | null
}
interface Product {
  id: string; name: string; price: number | null
  category_name: string | null; stock: number | null
}
interface Watch {
  product_id: string; added_at: string; match_mode: MatchMode; product: Product | null
}
interface Match {
  id: string; product_id: string; competitor_id: string
  competitor_title: string | null; competitor_url: string | null
  price: number | null; similarity: number | null
  status: string; checked_at: string | null; error: string | null
  is_chosen: boolean
  price_per_kg: number | null
  our_price_per_kg: number | null
  unit_label: string | null
  context_label: string | null
  context_note: string | null
  is_manual: boolean
  pinned_url: string | null
  our_amount: number | null; competitor_amount: number | null
  /** Their price at our pack size; null when either size is unknown */
  normalized_price: number | null
}
interface Snapshot { product_id: string; competitor_id: string; price: number; captured_at: string }

const money = (n: number | null | undefined) =>
  n == null ? '—' : `${Math.round(n).toLocaleString('uk-UA')} ₴`

const when = (iso: string | null) => iso
  ? new Date(iso).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  : 'ще не перевірялось'

export default function PricesClient({
  competitors, watches, matches, history, thresholds = DEFAULT_THRESHOLDS,
}: {
  competitors: Competitor[]
  watches: Watch[]
  matches: Match[]
  history: Snapshot[]
  thresholds?: Thresholds
}) {
  const router = useRouter()
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'overview' | 'settings' | 'competitors'>('overview')
  const [filter, setFilter] = useState<Verdict | 'all'>('all')
  // A view filter only. The 09:30 pass always covers every active competitor —
  // narrowing what is collected would quietly make the history incomparable.
  const [only, setOnly] = useState<Set<string>>(new Set())
  const [adviceOpen, setAdviceOpen] = useState(true)
  const [printing, setPrinting] = useState(false)
  const [adding, setAdding] = useState(false)
  const [run, setRun] = useState<RunState | null>(null)
  const polling = useRef<ReturnType<typeof setInterval> | null>(null)
  const [checkingId, setCheckingId] = useState<string | null>(null)

  const byProduct = useMemo(() => {
    const map = new Map<string, Match[]>()
    for (const m of matches) {
      if (only.size && !only.has(m.competitor_id)) continue
      map.set(m.product_id, [...(map.get(m.product_id) ?? []), m])
    }
    return map
  }, [matches, only])

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
      const mode = w.match_mode ?? 'similar'
      const trusted = MATCH_MODES[mode].trusted
      // One price per competitor. A shop can list the same sausage twice —
      // «Дрогобицька» and «Дрогобицька ТЕР в/с» — and averaging or taking both
      // would compare us against a shop competing with itself. The offer a
      // person marked wins; otherwise the best-scoring one stands in.
      // Міра ринку — тільки обрана позиція. Якщо в цього конкурента ніхто
      // нічого не обирав, беремо найсхожішу автоматичну. Підтверджені, але не
      // обрані, лишаються в переліку й оновлюються — але ціну не задають.
      const perCompetitor = new Map<string, Match>()
      for (const m of byProduct.get(product.id) ?? []) {
        if (m.price == null) continue

        const held = perCompetitor.get(m.competitor_id)
        if (m.is_chosen) { perCompetitor.set(m.competitor_id, m); continue }
        if (held?.is_chosen) continue
        if (Number(m.similarity ?? 0) < trusted) continue
        if (!held || Number(m.similarity ?? 0) > Number(held.similarity ?? 0)) {
          perCompetitor.set(m.competitor_id, m)
        }
      }
      const found = [...perCompetitor.values()]
      // Per kilogram wherever both sides have it. A tray at 60 ₴/200 г against
      // our kilogram is 300 against ours, not 60 — the printed numbers say the
      // opposite of the truth, so they are the last resort, not the first.
      const ourPerKg = found.map(m => m.our_price_per_kg).find(v => v != null)
      const perKg = found
        .map(m => m.price_per_kg)
        .filter((v): v is number => v != null)
        .map(Number)

      const byKilo = ourPerKg != null && perKg.length === found.length
      const advice = byKilo
        ? advise(Number(ourPerKg), perKg, thresholds)
        : advise(
            Number(product.price ?? 0),
            found.map(m => Number(m.normalized_price ?? m.price)),
            thresholds,
          )
      return {
        product,
        mode,
        byKilo,
        ourShown: byKilo ? Number(ourPerKg) : Number(product.price ?? 0),
        all: byProduct.get(product.id) ?? [],
        used: found,
        advice,
        /** Anything matched but too weak to price against, awaiting a person */
        unsure: (byProduct.get(product.id) ?? []).filter(
          m => m.status === 'auto' && m.price != null
            && Number(m.similarity ?? 0) < trusted),
      }
    }), [watches, byProduct, thresholds])

  const summary = useMemo(() => {
    const count = (v: Verdict) => rows.filter(r => r.advice.verdict === v).length
    // Priced against nothing, but a candidate is sitting there waiting to be
    // confirmed. Counting these as «немає даних» is what made a working match
    // look like a failure.
    const needsReview = rows.filter(
      r => r.advice.verdict === 'no_data' && (r.unsure.length || r.advice.suspect)).length
    const lift = rows
      .filter(r => r.advice.verdict === 'cheap' && r.advice.suggested)
      .reduce((s, r) => s + (r.advice.suggested! - Number(r.product.price ?? 0)), 0)
    return {
      expensive: count('expensive'), cheap: count('cheap'),
      aligned: count('aligned'), noData: count('no_data'),
      unsure: rows.filter(r => r.unsure.length).length,
      needsReview,
      noneAtAll: count('no_data') - needsReview,
      lift,
    }
  }, [rows])

  const shown = filter === 'all' ? rows : rows.filter(r => r.advice.verdict === filter)

  /** Rows worth acting on, dearest mistake first. */
  const actions = useMemo(() => rows
    .filter(r => r.advice.suggested != null && r.advice.verdict !== 'aligned')
    .sort((a, b) => Math.abs(b.advice.gapUah ?? 0) - Math.abs(a.advice.gapUah ?? 0))
    .slice(0, 12), [rows])

  /** Follows the pass while it runs, so the button is not a black box. */
  const poll = useCallback(async () => {
    try {
      const res = await fetch('/api/prices/run')
      const data = await res.json()
      setRun(data.run ? { ...data.run, queued: data.queued ?? 0 } : null)
      // Чекаємо не лише на прогін, а й на збирач: поки в черзі є сторінки,
      // робота триває
      if (data.run?.status !== 'running' && !(data.queued > 0) && polling.current) {
        clearInterval(polling.current)
        polling.current = null
        router.refresh()
      }
    } catch { /* a missed tick is not worth showing */ }
  }, [router])

  useEffect(() => {
    void poll()
    return () => { if (polling.current) clearInterval(polling.current) }
  }, [poll])

  async function startRun(productId?: string) {
    setCheckingId(productId ?? null)
    setError('')
    setRun({ status: 'running', total: 0, done: 0, matched: 0, missed: 0,
             current_step: 'Запускаємо…', error: null, started_at: new Date().toISOString(),
             finished_at: null })

    if (!polling.current) polling.current = setInterval(() => void poll(), 2000)

    try {
      const res = await fetch('/api/prices/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(productId ? { productId } : {}),
      })
      const data = await res.json()
      if (!res.ok && res.status !== 409) throw new Error(data.error || 'Помилка')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      void poll()
    }
  }

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
    <div className="p-4 sm:p-6 space-y-5 max-w-[1400px] mx-auto print-plain">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">Моніторинг цін</h1>
          <p className="text-zinc-400 text-sm mt-0.5">
            {watches.length} позицій · {active} {active === 1 ? 'конкурент' : 'конкурентів'} ·
            {' '}оновлення щодня о 9:30
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap no-print">
          {watches.length > 0 && (
            <>
              <a
                href="/api/prices/export"
                className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm
                           px-3 py-2 rounded-lg transition-colors"
              >
                ⤓ XLSX
              </a>
              {/* Print, not a generated file: the browser's own "save as PDF"
                  produces exactly what is on screen, and a second rendering
                  engine would be one more thing to keep in step with it */}
              <button
                onClick={() => {
                  setPrinting(true)
                  // Даємо React домалювати розгорнуті деталі до діалогу друку
                  setTimeout(() => { window.print(); setPrinting(false) }, 120)
                }}
                className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm
                           px-3 py-2 rounded-lg transition-colors"
              >
                ⎙ PDF
              </button>
            </>
          )}
          <button
            onClick={() => startRun()}
            disabled={run?.status === 'running' || !watches.length || !competitors.length}
            className="bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white text-sm
                       font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {run?.status === 'running' ? 'Перевіряємо…' : 'Перевірити зараз'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-950/50 border border-red-800 rounded-xl px-4 py-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      {run && <RunStatus run={run} />}

      <div className="flex gap-1 border-b border-zinc-800 no-print">
        {([
          ['overview', 'Огляд'],
          ['settings', `Налаштування моніторингу (${watches.length})`],
          ['competitors', `Конкуренти (${competitors.length})`],
        ] as const).map(
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
              action={<button onClick={() => setTab('settings')}
                className="text-red-400 hover:text-red-300 text-sm">Налаштувати моніторинг →</button>}
            />
          ) : (
            <>
              <Verdicts summary={summary} filter={filter} onFilter={setFilter} />

              {summary.needsReview > 0 && (
                <div className="bg-cyan-950/30 border border-cyan-900/60 rounded-xl px-4 py-3">
                  <div className="text-cyan-300 text-sm font-medium">
                    {summary.needsReview} {summary.needsReview === 1 ? 'позиція чекає' : 'позицій чекають'} на підтвердження
                  </div>
                  <div className="text-zinc-400 text-xs mt-1 leading-relaxed">
                    Схожі товари в конкурентів знайдено, але назви збігаються не настільки,
                    щоб рахувати їх автоматично. Розгорніть «Деталі» й натисніть «Це він» —
                    після цього ціна братиметься з тієї сторінки щоранку.
                  </div>
                </div>
              )}

              {actions.length > 0 && (
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                  <button
                    onClick={() => setAdviceOpen(!adviceOpen)}
                    className="w-full text-left px-4 py-3 border-b border-zinc-800
                               hover:bg-zinc-800/30 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`text-zinc-500 text-xs transition-transform ${
                        adviceOpen ? 'rotate-90' : ''
                      }`}>›</span>
                      <span className="text-white text-sm font-medium">
                        Рекомендації для цін
                      </span>
                      <span className="text-zinc-500 text-xs">({actions.length})</span>
                    </div>
                    <div className="text-zinc-500 text-xs mt-0.5 ml-5">
                      Показані лише позиції, де різниця більша за {thresholds.minAbs} ₴
                      і за {thresholds.minPct}% одночасно
                    </div>
                  </button>
                  <div className={`divide-y divide-zinc-800/60 ${adviceOpen ? '' : 'hidden'}`}>
                    {actions.map(r => {
                      const our = Number(r.product.price ?? 0)
                      const delta = (r.advice.suggested ?? our) - our
                      return (
                        <div key={r.product.id}
                          className="px-4 py-2.5 flex items-center gap-3 flex-wrap">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            VERDICT_META[r.advice.verdict].dot}`} />
                          <span className="text-zinc-200 text-xs min-w-0 flex-1 truncate">
                            {r.product.name}
                          </span>
                          <span className="text-zinc-500 text-xs tabular-nums shrink-0">
                            {money(our)} → <span className={
                              delta < 0 ? 'text-red-400' : 'text-emerald-400'
                            }>{money(r.advice.suggested)}</span>
                          </span>
                          <span className={`text-xs tabular-nums shrink-0 w-16 text-right ${
                            delta < 0 ? 'text-red-400' : 'text-emerald-400'
                          }`}>
                            {delta > 0 ? '+' : ''}{Math.round(delta)} ₴
                          </span>
                        </div>
                      )
                    })}
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
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-zinc-500 text-xs">Порівнювати з:</span>
                  <button
                    onClick={() => setOnly(new Set())}
                    className={`px-2.5 py-1 rounded-lg text-xs transition-colors border ${
                      only.size === 0
                        ? 'bg-red-600 border-red-600 text-white'
                        : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white'
                    }`}
                  >
                    Усіма
                  </button>
                  {competitors.filter(c => c.is_active).map(c => (
                    <button
                      key={c.id}
                      onClick={() => setOnly(prev => {
                        const next = new Set(prev)
                        if (next.has(c.id)) next.delete(c.id); else next.add(c.id)
                        return next
                      })}
                      className={`px-2.5 py-1 rounded-lg text-xs transition-colors border ${
                        only.has(c.id)
                          ? 'bg-red-600 border-red-600 text-white'
                          : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white'
                      }`}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                {shown.map(row => (
                  <ProductCard
                    key={row.product.id}
                    row={row}
                    competitors={competitors}
                    previous={previous}
                    busy={busy}
                    checking={run?.status === 'running' && checkingId === row.product.id}
                    printing={printing}
                    onCheck={() => startRun(row.product.id)}
                    onManual={body => call('/api/prices/manual', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ ...body, productId: row.product.id }),
                    }, row.product.id)}
                    onChoose={id => call('/api/prices/match', {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ id, choose: true }),
                    }, id)}
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
      ) : tab === 'settings' ? (
        <SettingsTab
          rows={rows}
          busy={busy}
          thresholds={thresholds}
          onThresholds={t => call('/api/prices/settings', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(t),
          }, 'thresholds')}
          onAdd={() => setAdding(true)}
          onMode={(ids, mode) => call('/api/prices/watch', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productIds: ids, mode }),
          }, ids[0] ?? 'mode')}
          onRemove={id => call(`/api/prices/watch?product_id=${id}`, { method: 'DELETE' }, id)}
        />
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
          onCity={(id, city_path) => call('/api/prices/competitors', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, city_path }),
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
  summary: {
    expensive: number; cheap: number; aligned: number
    noData: number; unsure: number; needsReview: number; noneAtAll: number
  }
  filter: Verdict | 'all'
  onFilter: (v: Verdict | 'all') => void
}) {
  const cards: { key: Verdict; value: number; hint: string }[] = [
    { key: 'expensive', value: summary.expensive, hint: 'дорожче ринку на 10%+' },
    { key: 'cheap',     value: summary.cheap,     hint: 'дешевше на 12%+' },
    { key: 'aligned',   value: summary.aligned,   hint: 'різниця в межах норми' },
    { key: 'no_data',   value: summary.noData,    hint: 'ще не порівняно' },
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
  mode: MatchMode
  /** Whether the numbers on this row are per kilogram */
  byKilo: boolean
  ourShown: number
  all: Match[]
  used: Match[]
  unsure: Match[]
  advice: ReturnType<typeof advise>
}

function ProductCard({
  row, competitors, previous, busy, checking, printing,
  onCheck, onMatch, onChoose, onManual, onRemove,
}: {
  row: Row
  competitors: Competitor[]
  previous: Map<string, number>
  busy: string
  checking: boolean
  printing: boolean
  onCheck: () => void
  onMatch: (id: string, status: string) => void
  onChoose: (id: string) => void
  onManual: (body: Record<string, unknown>) => void
  onRemove: () => void
}) {
  // Opened by default when the only thing standing between this product and a
  // comparison is someone looking at it
  const awaiting = row.advice.verdict === 'no_data' && row.unsure.length > 0
  const [open, setOpen] = useState(awaiting || row.advice.suspect)
  // Друк розгортає все: у PDF має піти те саме, що видно на розкритій
  // сторінці, а не перелік згорнутих заголовків
  const shown = open || printing
  const meta = VERDICT_META[row.advice.verdict]
  const our = row.ourShown
  const ourContext = contextLabel(row.product.name)
  const nameOf = (id: string) => competitors.find(c => c.id === id)?.name ?? '—'

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="px-4 py-3 flex items-start gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
              row.advice.suspect ? 'bg-amber-900/60 text-amber-300'
                : awaiting ? 'bg-cyan-900/60 text-cyan-300' : meta.badge
            }`}>
              {row.advice.suspect ? 'Перевірте одиниці'
                : awaiting ? 'Потребує підтвердження' : meta.label}
            </span>
            {row.unsure.length > 0 && !awaiting && (
              <span className="px-2 py-0.5 rounded text-xs bg-zinc-800 text-zinc-400">
                ще {row.unsure.length} під питанням
              </span>
            )}
          </div>
          <div className="text-white text-sm mt-1.5">{row.product.name}</div>
          {ourContext && (
            <div className="text-zinc-600 text-xs mt-0.5">{ourContext}</div>
          )}
          <div className="text-zinc-500 text-xs mt-0.5">
            {awaiting && !row.advice.suspect
              ? `Знайдено ${row.unsure.length} схожу позицію — підтвердьте нижче`
              : row.advice.reason}
            <span className="text-zinc-600"> · {MATCH_MODES[row.mode].label}</span>
          </div>
        </div>

        <div className="flex items-center gap-5 shrink-0">
          <div className="text-right">
            <div className="text-zinc-500 text-xs">
              Наша{row.byKilo && <span className="text-zinc-600"> ₴/кг</span>}
            </div>
            <div className="text-white text-sm font-semibold tabular-nums">{money(our)}</div>
          </div>
          <div className="text-right">
            <div className="text-zinc-500 text-xs">Найдешевший</div>
            <div className="text-zinc-300 text-sm tabular-nums">{money(row.advice.cheapest)}</div>
            {row.advice.gapUah != null && Math.abs(row.advice.gapUah) >= 1 && (
              <div className={`text-xs tabular-nums ${
                row.advice.gapUah > 0 ? 'text-red-400' : 'text-emerald-400'
              }`}>
                {row.advice.gapUah > 0 ? '+' : ''}{Math.round(row.advice.gapUah)} ₴
              </div>
            )}
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
            onClick={onCheck}
            disabled={checking}
            className="text-zinc-400 hover:text-white disabled:opacity-40 text-xs
                       px-2 py-1 transition-colors"
            title="Перевірити лише цей товар"
          >
            {checking ? 'Перевіряємо…' : '↻ Перевірити'}
          </button>
          <button
            onClick={() => setOpen(!open)}
            className="text-zinc-500 hover:text-white text-xs px-2 py-1 transition-colors"
          >
            {open ? 'Згорнути' : `Деталі (${row.all.length})`}
          </button>
        </div>
      </div>

      {shown && (
        <div className="border-t border-zinc-800 bg-zinc-800/20">
          {row.all.length === 0 ? (
            <div className="px-4 py-4 text-zinc-500 text-xs">
              Ще не перевірялось. Наступний обхід — завтра о 9:30.
            </div>
          ) : (
            <div className="divide-y divide-zinc-800/60">
              {/* Згруповано по конкурентах: питання «скільки це коштує в
                  Метро» ставлять про магазин, а не про перелік пропозицій */}
              {[...new Map(row.all.map(m => [m.competitor_id, m])).keys()].map(cid => {
                const offers = row.all
                  .filter(m => m.competitor_id === cid && m.price != null)
                  .sort((a, b) => (b.is_chosen ? 1 : 0) - (a.is_chosen ? 1 : 0)
                    || Number(b.similarity ?? 0) - Number(a.similarity ?? 0))
                const blank = row.all.filter(m => m.competitor_id === cid && m.price == null)
                const used = offers.find(o => o.is_chosen) ?? offers[0]

                return (
                  <div key={cid} className="py-1">
                    <div className="px-4 py-2 flex items-center gap-2 flex-wrap">
                      <span className="text-zinc-200 text-xs font-medium">{nameOf(cid)}</span>
                      {used?.price_per_kg != null && (
                        <span className="text-white text-xs tabular-nums">
                          {money(Number(used.price_per_kg))}<span className="text-zinc-600">/кг</span>
                        </span>
                      )}
                      {used?.price_per_kg != null && our > 0 && (
                        <span className={`text-xs tabular-nums ${
                          Number(used.price_per_kg) < our ? 'text-red-400' : 'text-emerald-400'
                        }`}>
                          {Number(used.price_per_kg) < our ? 'дешевше на ' : 'дорожче на '}
                          {money(Math.abs(Math.round(Number(used.price_per_kg) - our)))}
                        </span>
                      )}
                      {!offers.length && (
                        <span className="text-zinc-600 text-xs">
                          {blank[0]?.error ?? 'немає збігу'}
                        </span>
                      )}
                      {offers.length > 1 && (
                        <span className="text-zinc-600 text-xs">
                          · ще {offers.length - 1} на вибір
                        </span>
                      )}
                    </div>
                    <div className="pl-4 border-l border-zinc-800 ml-4">
                      {offers.map(m => {
                const was = previous.get(`${m.product_id}|${m.competitor_id}`)
                const score = Number(m.similarity ?? 0)
                // Judged against this product's own setting, not a fixed number
                const weak = m.status === 'auto' && score < MATCH_MODES[row.mode].trusted
                return (
                  <div key={m.id} className="px-4 py-2.5 flex items-start gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        {m.is_manual && (
                          <span className="text-cyan-400 text-xs">✎ внесено вручну</span>
                        )}
                        {m.status === 'confirmed' && !m.is_manual && !m.is_chosen && (
                          <span className="text-emerald-400 text-xs">✓ стежимо за ціною</span>
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
                        <>
                          <a
                            href={m.competitor_url?.startsWith('http') ? m.competitor_url : undefined}
                            target="_blank"
                            rel="noreferrer"
                            className="text-zinc-500 hover:text-zinc-300 text-xs mt-0.5 block truncate transition-colors"
                          >
                            {m.competitor_title ?? '—'}
                          </a>
                          {/* What the matcher understood this to be. A score
                              explains nothing; «курятина · стегно» explains it */}
                          {m.context_label && (
                            <div className="text-zinc-600 text-xs mt-0.5">
                              {m.context_label}
                              {m.context_note && (
                                <span className="text-amber-500/80"> · {m.context_note}</span>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-white text-sm tabular-nums">
                        {money(m.price_per_kg != null ? Number(m.price_per_kg)
                          : m.normalized_price != null ? Number(m.normalized_price) : m.price)}
                        {m.price_per_kg != null && (
                          <span className="text-zinc-600 text-xs"> /кг</span>
                        )}
                      </div>
                      {/* The working, so a converted figure is never mistaken
                          for the shop's own price tag */}
                      {m.price_per_kg != null && m.price != null
                        && Math.round(Number(m.price_per_kg)) !== Math.round(Number(m.price)) && (
                        <div className="text-zinc-600 text-xs">
                          з {money(m.price)}
                          {m.competitor_amount ? ` за ${amountLabel(Number(m.competitor_amount))}` : ''}
                        </div>
                      )}
                      {/* Both numbers, because the scaled one is not their
                          price tag and should never be mistaken for it */}
                      {m.normalized_price != null && m.competitor_amount != null
                        && Math.round(Number(m.normalized_price)) !== Math.round(Number(m.price ?? 0)) && (
                        <div className="text-zinc-600 text-xs">
                          зведено з {money(m.price)} за {amountLabel(Number(m.competitor_amount))}
                        </div>
                      )}
                      {/* Раніше тут було просто «↓ з 578 ₴» — число без пояснення.
                          Це попередня ціна цієї самої позиції. */}
                      {was != null && m.price != null && Math.round(was) !== Math.round(Number(m.price)) && (
                        <div className={`text-xs tabular-nums ${
                          Number(m.price) > was ? 'text-red-400' : 'text-emerald-400'
                        }`}>
                          було {money(was)}
                          <span className="text-zinc-600">
                            {' '}{Number(m.price) > was ? '· подорожчало' : '· подешевшало'}
                          </span>
                        </div>
                      )}
                    </div>

                    {m.price != null && (
                      <div className="flex items-center gap-1 shrink-0 no-print">
                        {m.is_chosen && (
                          <span className="text-emerald-400 text-xs px-2">
                            ● порівнюємо з цією{m.pinned_url ? ' · беремо звідси щоранку' : ''}
                          </span>
                        )}
                        {!m.is_chosen && (
                          <button
                            disabled={busy === m.id}
                            onClick={() => onChoose(m.id)}
                            className="text-cyan-400 hover:text-cyan-300 text-xs px-2 py-1 transition-colors"
                            title="Порівнювати ціну саме з цією позицією"
                          >
                            Порівнювати з цією
                          </button>
                        )}
                        {m.status !== 'confirmed' && !m.is_chosen && (
                          <button
                            disabled={busy === m.id}
                            onClick={() => onMatch(m.id, 'confirmed')}
                            className="text-emerald-400 hover:text-emerald-300 text-xs px-2 py-1 transition-colors"
                            title="Той самий товар — стежити за його ціною, але не порівнювати"
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
                  </div>
                )
              })}
            </div>
          )}

          {/* Shops that refuse to be read still belong in the comparison —
              with a price someone looked up and typed */}
          {competitors.some(c => !c.readable && c.is_active) && (
            <ManualRow
              productId={row.product.id}
              competitors={competitors.filter(c => !c.readable && c.is_active)}
              busy={busy}
              onSave={onManual}
            />
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

function CompetitorsTab({ competitors, busy, onAdd, onToggle, onCity, onDelete }: {
  competitors: Competitor[]
  busy: string
  onAdd: (body: { name: string; site_url: string; search_url: string }) => void
  onToggle: (id: string, is_active: boolean) => void
  onCity: (id: string, city: string) => void
  onDelete: (id: string) => void
}) {
  const [name, setName] = useState('')
  const [site, setSite] = useState('')
  const [search, setSearch] = useState('')
  const [manual, setManual] = useState(false)

  const field = 'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-red-500'

  return (
    <div className="space-y-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
        <div className="text-white text-sm font-medium">Додати конкурента</div>

        <p className="text-zinc-500 text-xs leading-relaxed">
          Достатньо назви й адреси сайту — пошук на ньому знайдеться сам.
          Перевірка займає кілька секунд.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input value={name} onChange={e => setName(e.target.value)}
            placeholder="Назва — напр. Родинна Ковбаска" className={field} />
          <input value={site} onChange={e => setSite(e.target.value)}
            placeholder="https://rodynna-kovbaska.ua" className={field} />
        </div>

        {/* Kept, but out of the way: needed only by the rare shop whose search
            is somewhere no common platform puts it */}
        <button
          type="button"
          onClick={() => setManual(!manual)}
          className="text-zinc-500 hover:text-zinc-300 text-xs transition-colors"
        >
          {manual ? '− Сховати' : '+ Вказати адресу пошуку вручну'}
        </button>

        {manual && (
          <div className="space-y-1.5">
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="https://shop.ua/search?q={q}" className={field} />
            <p className="text-zinc-600 text-xs">
              Знайдіть у них будь-який товар через пошук, скопіюйте адресу з рядка
              браузера і замініть свій запит на <code className="text-red-400">{'{q}'}</code>.
            </p>
          </div>
        )}

        <button
          disabled={busy === 'add' || !name.trim() || !site.trim()}
          onClick={() => { onAdd({ name, site_url: site, search_url: search }); setName(''); setSite(''); setSearch('') }}
          className="bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white text-sm
                     font-medium px-4 py-2 rounded-lg transition-colors"
        >
          {busy === 'add' ? 'Шукаємо пошук на сайті…' : 'Додати'}
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

                {!c.readable && (
                  <div className="text-cyan-400/80 text-xs mt-1">
                    Сайт не віддає сторінки нашому серверу — ціни вносяться вручну
                    в деталях товару
                  </div>
                )}
                <div className="text-zinc-600 text-xs mt-0.5">
                  Ціни читаємо для міста:{' '}
                  <span className="text-zinc-400">
                    {c.city_path || 'за замовчуванням сайту'}
                  </span>
                </div>
                {/* Only a real failure, and only once: "no search" is now a
                    route we take rather than a problem to report */}
                {c.last_error && c.search_url && (
                  <div className="text-amber-400 text-xs mt-1">⚠ {c.last_error}</div>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {/* Same site, different prices per city — chicken fillet is
                    219 ₴ in Lviv and 210 ₴ in Vinnytsia. Reading whichever page
                    a link points at makes the comparison depend on chance. */}
                <label className="flex items-center gap-1.5">
                  <span className="text-zinc-500 text-xs">Місто:</span>
                  <input
                    defaultValue={c.city_path}
                    placeholder="за замовч."
                    onBlur={e => {
                      if (e.target.value.trim() !== c.city_path) {
                        onCity(c.id, e.target.value)
                      }
                    }}
                    className="w-28 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1
                               text-white text-xs focus:outline-none focus:border-red-500"
                  />
                </label>
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

/**
 * Which of our products are watched, and how strictly each is matched.
 *
 * Separate from the overview because these are two different jobs: the overview
 * answers "what should I do about prices today", this answers "what are we even
 * comparing" — a question you revisit rarely and in bulk.
 */
function SettingsTab({ rows, busy, thresholds, onAdd, onMode, onRemove, onThresholds }: {
  rows: Row[]
  busy: string
  thresholds: Thresholds
  onAdd: () => void
  onMode: (ids: string[], mode: MatchMode) => void
  onRemove: (id: string) => void
  onThresholds: (t: Thresholds) => void
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const toggle = (id: string) => setPicked(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  return (
    <div className="space-y-4">
      <ThresholdsBox thresholds={thresholds} busy={busy} onSave={onThresholds} />

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
        <div className="text-white text-sm font-medium">Ступінь схожості</div>
        <p className="text-zinc-500 text-xs mt-1.5 leading-relaxed">
          Задається для кожного товару окремо. Для банки з відомою маркою існує рівно
          один відповідник, і все інше під тією ж назвою — сміття. Для фаршу чи олії
          прямого відповідника немає взагалі: там питання в тому, скільки коштує
          рівноцінна пачка деінде.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
          {(Object.keys(MATCH_MODES) as MatchMode[]).map(key => (
            <div key={key} className="bg-zinc-800/40 rounded-lg px-3 py-2.5">
              <div className="text-zinc-200 text-xs font-medium">{MATCH_MODES[key].label}</div>
              <div className="text-zinc-500 text-xs mt-1 leading-relaxed">{MATCH_MODES[key].hint}</div>
            </div>
          ))}
        </div>
        <p className="text-zinc-600 text-xs mt-3 leading-relaxed">
          Де фасування різні й режим це дозволяє, ціна конкурента зводиться до нашої
          пачки: їхній кілограм за 300 ₴ проти нашої півкілограмової за 180 ₴ — це вони
          дешевші, хоча на ціннику більше число.
        </p>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-zinc-400 text-sm">
          {rows.length} {rows.length === 1 ? 'позиція' : 'позицій'} під наглядом
        </span>
        <button
          onClick={onAdd}
          className="bg-red-600 hover:bg-red-500 text-white text-sm font-medium
                     px-4 py-2 rounded-lg transition-colors"
        >
          + Додати товари
        </button>
      </div>

      {picked.size > 0 && (
        <div className="bg-zinc-800/60 border border-zinc-700 rounded-xl px-4 py-3
                        flex items-center gap-3 flex-wrap sticky top-2 z-10">
          <span className="text-white text-sm">Обрано: {picked.size}</span>
          <span className="text-zinc-500 text-xs">Змінити ступінь на:</span>
          {(Object.keys(MATCH_MODES) as MatchMode[]).map(key => (
            <button
              key={key}
              disabled={!!busy}
              onClick={() => { onMode([...picked], key); setPicked(new Set()) }}
              className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-zinc-100
                         text-xs px-3 py-1.5 rounded-lg transition-colors"
            >
              {MATCH_MODES[key].label}
            </button>
          ))}
          <button onClick={() => setPicked(new Set())}
            className="text-zinc-500 hover:text-white text-xs ml-auto">× зняти</button>
        </div>
      )}

      {!rows.length ? (
        <Empty
          title="Жодного товару ще не обрано"
          body="Оберіть позиції, ціни яких варто тримати під наглядом. Решта каталогу перевірятись не буде."
          action={<button onClick={onAdd}
            className="text-red-400 hover:text-red-300 text-sm">Додати товари →</button>}
        />
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl divide-y divide-zinc-800">
          {rows.map(row => {
            const on = picked.has(row.product.id)
            const amount = amountLabel(
              row.all[0]?.our_amount != null ? Number(row.all[0].our_amount) : null)
            return (
              <div key={row.product.id}
                className={`px-4 py-3 flex items-center gap-3 flex-wrap transition-colors ${
                  on ? 'bg-red-600/10' : ''
                }`}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(row.product.id)}
                  className="accent-red-600 w-4 h-4 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-white text-sm truncate">{row.product.name}</div>
                  <div className="text-zinc-500 text-xs mt-0.5">
                    {money(row.product.price)}
                    {amount && <span className="text-zinc-600"> · фасування {amount}</span>}
                    {' · '}{row.product.category_name ?? 'без категорії'}
                  </div>
                </div>

                <select
                  value={row.mode}
                  disabled={busy === row.product.id}
                  onChange={e => onMode([row.product.id], e.target.value as MatchMode)}
                  className="bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5
                             text-white text-xs focus:outline-none focus:border-red-500 shrink-0"
                >
                  {(Object.keys(MATCH_MODES) as MatchMode[]).map(key => (
                    <option key={key} value={key}>{MATCH_MODES[key].label}</option>
                  ))}
                </select>

                <button
                  onClick={() => onRemove(row.product.id)}
                  disabled={busy === row.product.id}
                  className="text-zinc-500 hover:text-red-400 text-xs px-2 py-1 transition-colors shrink-0"
                >
                  Прибрати
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

interface RunState {
  status: string
  total: number
  done: number
  matched: number
  missed: number
  current_step: string | null
  error: string | null
  started_at: string
  finished_at: string | null
  /** Сторінок у черзі на збирач */
  queued?: number
}

/**
 * What the pass is doing, while it does it.
 *
 * A check over a few dozen product-and-competitor pairs takes minutes, most of
 * it waiting politely between requests to someone else's site. Without this the
 * button looks broken — which is exactly how it did look.
 */
function RunStatus({ run }: { run: RunState }) {
  const running = run.status === 'running'
  const pct = run.total > 0 ? Math.min(100, Math.round((run.done / run.total) * 100)) : 0

  const queued = run.queued ?? 0

  if (!running && queued > 0) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3
                      flex items-center gap-3 flex-wrap">
        <span className="w-3 h-3 rounded-full border-2 border-cyan-500 border-t-transparent
                         animate-spin shrink-0" />
        <span className="text-white text-sm">Збирач дочитує сайти</span>
        <span className="text-zinc-500 text-xs">лишилось сторінок: {queued}</span>
        <span className="text-zinc-600 text-xs">
          Магазини, які не віддають сторінки серверу, читає браузер — це кілька хвилин
        </span>
      </div>
    )
  }

  if (!running && run.status === 'done' && !run.error) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3
                      flex items-center gap-3 flex-wrap">
        <span className="text-emerald-400 text-sm">✓ Перевірку завершено</span>
        <span className="text-zinc-500 text-xs">
          знайдено {run.matched} · без збігу {run.missed} · {when(run.finished_at)}
        </span>
      </div>
    )
  }

  return (
    <div className={`border rounded-xl px-4 py-3 ${
      run.status === 'failed'
        ? 'bg-red-950/40 border-red-900'
        : 'bg-zinc-900 border-zinc-800'
    }`}>
      <div className="flex items-center gap-3 flex-wrap">
        {running && (
          <span className="w-3 h-3 rounded-full border-2 border-red-500 border-t-transparent
                           animate-spin shrink-0" />
        )}
        <span className="text-white text-sm">
          {run.status === 'failed' ? 'Перевірка не завершилась' : 'Перевіряємо ціни'}
        </span>
        {run.total > 0 && (
          <span className="text-zinc-500 text-xs tabular-nums">
            {run.done} з {run.total}
          </span>
        )}
        {run.matched + run.missed > 0 && (
          <span className="text-zinc-600 text-xs">
            знайдено {run.matched} · без збігу {run.missed}
          </span>
        )}
      </div>

      {run.total > 0 && running && (
        <div className="h-1 bg-zinc-800 rounded-full mt-2.5 overflow-hidden">
          <div className="h-full bg-red-500 transition-all duration-500"
            style={{ width: `${pct}%` }} />
        </div>
      )}

      {run.current_step && running && (
        <div className="text-zinc-500 text-xs mt-2 truncate">{run.current_step}</div>
      )}

      {run.error && (
        <div className="text-amber-400 text-xs mt-2">{run.error}</div>
      )}

      {running && (
        <p className="text-zinc-600 text-xs mt-2 leading-relaxed">
          Між запитами до чужого сайту витримується пауза, тож перевірка кількох
          десятків позицій триває хвилини. Сторінку можна закрити — перевірка
          не переривається.
        </p>
      )}
    </div>
  )
}

/**
 * Where the line between noise and a pricing problem sits.
 *
 * Both numbers, not one. Percentages alone treat a 20 ₴ line and a 500 ₴ line
 * alike; hryvnia alone flags everything expensive. A gap has to clear both
 * before the page calls it a problem.
 */
function ThresholdsBox({ thresholds, busy, onSave }: {
  thresholds: Thresholds
  busy: string
  onSave: (t: Thresholds) => void
}) {
  const [draft, setDraft] = useState(thresholds)
  const dirty = draft.minAbs !== thresholds.minAbs
    || draft.minPct !== thresholds.minPct
    || draft.undercutPct !== thresholds.undercutPct

  const field = 'w-24 bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-white text-sm focus:outline-none focus:border-red-500'

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <div className="text-white text-sm font-medium">Коли різниця вважається суттєвою</div>
      <p className="text-zinc-500 text-xs mt-1.5 leading-relaxed">
        Позиція потрапляє в «Дорого» або «Дешево», лише коли різниця перевищує
        обидва пороги. П&apos;ять гривень різниці — це не проблема ціноутворення
        ні за якої ціни, і сторінка, яка про них кричить, привчає себе ігнорувати.
      </p>

      <div className="flex items-end gap-4 flex-wrap mt-3">
        <label className="block">
          <span className="text-zinc-400 text-xs block mb-1">Поріг, ₴</span>
          <input type="number" min={0} max={10000} value={draft.minAbs}
            onChange={e => setDraft({ ...draft, minAbs: Number(e.target.value) })}
            className={field} />
        </label>
        <label className="block">
          <span className="text-zinc-400 text-xs block mb-1">Поріг, %</span>
          <input type="number" min={0} max={90} value={draft.minPct}
            onChange={e => setDraft({ ...draft, minPct: Number(e.target.value) })}
            className={field} />
        </label>
        <label className="block">
          <span className="text-zinc-400 text-xs block mb-1">Підрізати на, %</span>
          <input type="number" min={0} max={50} value={draft.undercutPct}
            onChange={e => setDraft({ ...draft, undercutPct: Number(e.target.value) })}
            className={field} />
        </label>

        {dirty && (
          <button
            disabled={busy === 'thresholds'}
            onClick={() => onSave(draft)}
            className="bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white text-sm
                       font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {busy === 'thresholds' ? 'Зберігаємо…' : 'Зберегти'}
          </button>
        )}
      </div>

      <p className="text-zinc-600 text-xs mt-3">
        «Підрізати на» — наскільки нижче за найдешевшого конкурента ставити
        рекомендовану ціну. Нуль означає рівно в його ціну.
      </p>
    </div>
  )
}

/**
 * Typing in a price for a shop that will not be read.
 *
 * Kept inside the product's own details rather than on a page of its own: the
 * question «what does Сільпо charge for this» only ever comes up while looking
 * at this product, and a separate screen would be a separate thing to remember.
 */
function ManualRow({ productId, competitors, busy, onSave }: {
  productId: string
  competitors: Competitor[]
  busy: string
  onSave: (body: Record<string, unknown>) => void
}) {
  const [open, setOpen] = useState(false)
  const [competitorId, setCompetitorId] = useState(competitors[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [price, setPrice] = useState('')
  const [unit, setUnit] = useState('/кг')
  const [url, setUrl] = useState('')

  const field = 'bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-white text-xs placeholder-zinc-600 focus:outline-none focus:border-red-500'

  if (!open) {
    return (
      <div className="px-4 py-2 border-t border-zinc-800">
        <button
          onClick={() => setOpen(true)}
          className="text-cyan-400 hover:text-cyan-300 text-xs transition-colors"
        >
          + Внести ціну вручну ({competitors.map(c => c.name).join(', ')})
        </button>
      </div>
    )
  }

  return (
    <div className="px-4 py-3 border-t border-zinc-800 bg-zinc-800/30 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <select value={competitorId} onChange={e => setCompetitorId(e.target.value)}
          className={field}>
          {competitors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input value={title} onChange={e => setTitle(e.target.value)}
          placeholder="Назва позиції у конкурента" className={`${field} flex-1 min-w-[200px]`} />
        <input value={price} onChange={e => setPrice(e.target.value)}
          placeholder="Ціна" inputMode="decimal" className={`${field} w-24`} />
        <select value={unit} onChange={e => setUnit(e.target.value)} className={field}>
          <option value="/кг">за кг</option>
          <option value="/100г">за 100 г</option>
          <option value="/200г">за 200 г</option>
          <option value="/500г">за 500 г</option>
          <option value="">за упаковку</option>
        </select>
      </div>

      <input value={url} onChange={e => setUrl(e.target.value)}
        placeholder="Посилання на позицію (необовʼязково)" className={`${field} w-full`} />

      <div className="flex items-center gap-2">
        <button
          disabled={!!busy || !title.trim() || !price}
          onClick={() => {
            onSave({ competitorId, title, price: Number(price.replace(',', '.')), unit, url })
            setTitle(''); setPrice(''); setUrl(''); setOpen(false)
          }}
          className="bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white text-xs
                     font-medium px-3 py-1.5 rounded-lg transition-colors"
        >
          Зберегти
        </button>
        <button onClick={() => setOpen(false)}
          className="text-zinc-500 hover:text-white text-xs px-2 py-1.5 transition-colors">
          Скасувати
        </button>
        <span className="text-zinc-600 text-xs">
          Ціна перерахується за кілограм і більше не перезаписуватиметься автоматично
        </span>
      </div>
    </div>
  )
}

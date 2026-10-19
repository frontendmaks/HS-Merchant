'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Вибір товарів для замовлення.
 *
 * Один і той самий підбір потрібен і коли замовлення приймають телефоном, і
 * коли його правлять уже після сайту: товари ті самі, каталог той самий, і
 * другий такий самий екран розійшовся б із першим на першій же зміні.
 */

export interface Product {
  id: string; name: string; sku: string | null; code_1c: string | null
  price: number; unit: string; pack: number | null
  stock: number | null; status: string; category: string | null
}

export interface Line {
  key: string
  product_id: string | null
  /** Товар у каталозі Бітрікса — у позицій, що приїхали звідти */
  bitrix_product_id?: number | null
  title: string
  unit: string
  unit_weight: number
  price_per_unit: number
  qty: number
}

export const money = (n: number) => `${Math.round(n * 100) / 100} ₴`
export const field = 'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-red-500'

export default function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-5xl my-8"
        onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

/**
 * Перелік товару.
 *
 * Пошук шукає серед усього каталогу — включно зі знятим із продажу, бо по
 * телефону замовляють і те, чого на сайті вже немає. Стан товару при цьому
 * видно: оператор має знати, що саме пропонує.
 *
 * Зібране замовлення стоїть поруч із пошуком, а не під ним: його читають
 * уголос клієнту, і для цього воно має бути на очах увесь час.
 */
/**
 * Поле для кількості й ціни.
 *
 * Звичайний `type="number"` зі значенням-числом не дає стерти останню цифру:
 * щойно поле пустіє, стан перетворює його на 0, і оператор щоразу мусить
 * видаляти нуль перед тим, як вписати «1.6». Тут набране лежить рядком, тож
 * поле можна спокійно очистити й почати спочатку, а кому вважаємо точкою —
 * на цифровій клавіатурі вона під рукою.
 */
function NumField({ value, onChange, className, autoFocus }: {
  value: number
  onChange: (v: number) => void
  className?: string
  autoFocus?: boolean
}) {
  const [draft, setDraft] = useState(value ? String(value) : '')
  const box = useRef<HTMLInputElement>(null)

  // Щойно доданий рядок сам підставляє курсор під кількість: оператор
  // називає її вголос наступним словом після назви товару
  useEffect(() => {
    if (!autoFocus || !box.current) return
    box.current.focus()
    box.current.select()
    box.current.scrollIntoView({ block: 'nearest' })
  }, [autoFocus])

  // Значення змінили зовні (новий рядок, перерахунок) — підхоплюємо
  useEffect(() => {
    if (Number(draft || 0) !== value) setDraft(value ? String(value) : '')
     
  }, [value])

  return (
    <input
      ref={box}
      type="text"
      inputMode="decimal"
      value={draft}
      placeholder="0"
      onChange={e => {
        const next = e.target.value.replace(',', '.')
        if (next !== '' && !/^\d*\.?\d*$/.test(next)) return
        setDraft(next)
        onChange(next === '' || next === '.' ? 0 : Number(next))
      }}
      className={className}
    />
  )
}

export function ProductPicker({ lines, onChange, total }: {
  lines: Line[]
  onChange: (lines: Line[]) => void
  total: number
}) {
  const [query, setQuery] = useState('')
  const [added, setAdded] = useState<string | null>(null)
  const [catalogue, setCatalogue] = useState<Product[] | null>(null)

  /**
   * Каталог береться один раз, щойно відкрилась форма.
   *
   * Дві тисячі позицій — це один запит замість запиту на кожну літеру, і
   * підказка з'являється тієї ж миті, коли оператор домовляє слово. Поки
   * список їде, поле вже приймає введення: доки оператор допише перше слово,
   * каталог здебільшого вже тут.
   */
  useEffect(() => {
    let alive = true
    void (async () => {
      const r = await fetch('/api/orders/manual/products')
      const d = await r.json().catch(() => ({}))
      if (alive) setCatalogue(d.products ?? [])
    })()
    return () => { alive = false }
  }, [])

  const needle = query.trim().toLowerCase()
  const found = needle.length < 2 || !catalogue ? [] : (() => {
    const hits: Product[] = []
    for (const p of catalogue) {
      if (p.name.toLowerCase().includes(needle)
        || p.sku?.toLowerCase().includes(needle)
        || p.code_1c?.toLowerCase().includes(needle)) {
        hits.push(p)
        if (hits.length === 40) break
      }
    }
    return hits
  })()
  const searching = needle.length >= 2 && !catalogue

  function add(p: Product) {
    // Ваговий товар додається одним фасуванням, штучний — однією штукою:
    // саме так його й замовляють уголос
    const pack = p.pack ?? 0
    const qty = p.unit === 'кг' && pack > 0 ? pack : 1
    const key = `${p.id}-${Date.now()}`
    setAdded(key)
    onChange([...lines, {
      key,
      product_id: p.id,
      title: p.name,
      unit: p.unit,
      unit_weight: pack,
      price_per_unit: p.price,
      qty,
    }])
    // Порожній рядок пошуку ховає підказки сам — список рахується з нього
    setQuery('')
  }

  const patch = (key: string, next: Partial<Line>) =>
    onChange(lines.map(l => (l.key === key ? { ...l, ...next } : l)))

  return (
    <div className="bg-zinc-800/30 border border-zinc-800 rounded-xl p-3 flex flex-col gap-3
                    max-h-[70vh]">
      <div className="relative">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Пошук товару: назва, артикул або код 1С"
          className={field}
        />
        {(found.length > 0 || searching) && (
          <div className="absolute z-20 left-0 right-0 mt-1 bg-zinc-800 border border-zinc-700
                          rounded-lg max-h-72 overflow-y-auto">
            {searching && <div className="px-3 py-2 text-zinc-500 text-xs">Завантажуємо каталог…</div>}
            {found.map(p => (
              <button
                key={p.id}
                onClick={() => add(p)}
                className="w-full text-left px-3 py-2 hover:bg-zinc-700 transition-colors
                           border-b border-zinc-700/50 last:border-0"
              >
                <div className="flex items-start gap-2">
                  <span className="text-white text-sm min-w-0 flex-1">{p.name}</span>
                  <span className="text-zinc-300 text-xs whitespace-nowrap">
                    {p.price} ₴/{p.unit}
                  </span>
                </div>
                <div className="text-zinc-500 text-xs mt-0.5">
                  {p.sku ?? '—'}
                  {p.pack ? ` · фасування ${p.pack} ${p.unit}` : ''}
                  {p.status !== 'active' && (
                    <span className="text-amber-500"> · знято з продажу</span>
                  )}
                  {p.stock === 0 && <span className="text-amber-500"> · немає на складі</span>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="text-zinc-400 text-xs">Замовлення</div>

      <div className="flex-1 overflow-y-auto space-y-1.5 min-h-[120px]">
        {lines.length === 0 && (
          <div className="text-zinc-600 text-xs px-1 py-6 text-center">
            Знайдіть товар у полі вище — він з’явиться тут
          </div>
        )}
        {lines.map((l, i) => (
          <div key={l.key} className="bg-zinc-800/60 rounded-lg px-2.5 py-2">
            <div className="flex items-start gap-2">
              <span className="text-zinc-600 text-xs w-4 shrink-0 pt-0.5">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="text-white text-xs leading-snug">{l.title}</div>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <NumField
                    value={l.qty}
                    autoFocus={l.key === added}
                    onChange={v => patch(l.key, { qty: v })}
                    className="w-20 bg-zinc-900 border border-zinc-700 rounded px-2 py-1
                               text-white text-xs focus:outline-none focus:border-red-500"
                  />
                  <span className="text-zinc-500 text-xs w-7">{l.unit}</span>
                  <span className="text-zinc-600 text-xs">×</span>
                  <NumField
                    value={l.price_per_unit}
                    onChange={v => patch(l.key, { price_per_unit: v })}
                    className="w-20 bg-zinc-900 border border-zinc-700 rounded px-2 py-1
                               text-white text-xs focus:outline-none focus:border-red-500"
                  />
                  <span className="text-white text-xs ml-auto tabular-nums">
                    {money(l.qty * l.price_per_unit)}
                  </span>
                </div>
              </div>
              <button
                onClick={() => onChange(lines.filter(x => x.key !== l.key))}
                className="text-zinc-600 hover:text-red-400 text-xs shrink-0 transition-colors"
                title="Прибрати"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-zinc-800 pt-2 flex items-center justify-between">
        <span className="text-zinc-400 text-xs">Разом</span>
        <span className="text-white text-sm font-semibold tabular-nums">{money(total)}</span>
      </div>
    </div>
  )
}

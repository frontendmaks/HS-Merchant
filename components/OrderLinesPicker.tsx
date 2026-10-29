'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

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
  /** «bitrix» — товар є лише в CRM */
  source?: 'site' | 'bitrix'
  bitrix_product_id?: number
  /** Коли цей товар востаннє продали за цією ціною */
  price_from?: string | null
  /** Знімок із сайту — у товарів Бітрікса його немає */
  image?: string | null
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
  /** Кілограмами чи штуками — для вагового товару це різні замовлення */
  order_unit?: 'кг' | 'шт' | null
  pieces?: number | null
}

export const money = (n: number) => `${Math.round(n * 100) / 100} ₴`
/*
 * Спільне поле форми.
 *
 * Висота дотику задана мінімумом, а не фіксованим `h-11`: цей самий
 * клас носять і текстові поля на кілька рядків, яким фіксована висота
 * зрізала б текст. До `lg` мінімум сорок чотири, далі — як було.
 */
export const field = 'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 min-h-11 lg:min-h-0 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-red-500'

export default function Overlay({ children }: { children: React.ReactNode }) {
  return (
    /*
     * Промах повз вікно його не закриває.
     *
     * Доти клік у темне поле довкола означав «закрити», і пів години
     * набраного замовлення зникало від випадкового дотику поруч із
     * полем — а оформлюють його, розмовляючи з клієнтом, і руки там
     * не завжди влучні. Вийти можна кнопкою: «Скасувати», хрестик або
     * «Готово» є в кожному з цих вікон, і кожна з них — свідомий рух.
     */
    /*
     * Поля довкола вікна — вужчі на телефоні.
     *
     * Чотири пікселі з кожного боку плюс тридцять два згори на екрані
     * 375 з'їдали майже десяту частину ширини, якої й так бракує, і
     * відсували вікно так, що заголовок опинявся за межею екрана.
     */
    <div className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center
                    p-2 sm:p-4 overflow-y-auto">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-5xl my-3 sm:my-8">
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

export /** Ваговий товар із відомим фасуванням — лише його можна рахувати штуками */
const weighted = (l: Line) => l.unit === 'кг' && (l.unit_weight ?? 0) > 0

const byPieces = (l: Line) => weighted(l) && l.order_unit === 'шт'

/**
 * Перемикання одиниці замовлення.
 *
 * Кількість перераховується, щоб у рядку не лишалось чуже число: дві штуки
 * по 400 г — це 0.8 кг, і навпаки.
 */
function toggleUnit(l: Line, unit: 'кг' | 'шт'): Partial<Line> {
  if (unit === 'шт') {
    const pieces = Math.max(1, Math.round((l.qty || 0) / (l.unit_weight || 1)))
    return { order_unit: 'шт', pieces, qty: Math.round(pieces * l.unit_weight * 1000) / 1000 }
  }
  return { order_unit: 'кг', pieces: null }
}

function UnitToggle({ line, onPick }: { line: Line; onPick: (u: 'кг' | 'шт') => void }) {
  return (
    <div className="flex rounded overflow-hidden border border-zinc-700">
      {(['шт', 'кг'] as const).map(u => (
        <button
          key={u}
          onClick={() => onPick(u)}
          className={`px-1.5 py-0.5 text-xs transition-colors ${
            (line.order_unit ?? 'кг') === u
              ? 'bg-red-600 text-white'
              : 'bg-zinc-900 text-zinc-400 hover:text-white'
          }`}
        >
          {u}
        </button>
      ))}
    </div>
  )
}

/**
 * Назва товару у вигляді, придатному для пошуку.
 *
 * Лапки, коми й скісні риски в назвах є, а в тому, що набирають, — ні.
 * «Ковбаса "Дрогобицька" в/г, упак, 700 г» і «ковб дро» мають зійтись.
 */
const normalise = (s: string) =>
  s.toLowerCase()
    .replace(/[\u2019'"«»„“”`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/**
 * Збіг за кількома уривками слів.
 *
 * Оператор набирає на слух і скорочує: «ковб дро», «сир укр трад». Пошук
 * одним суцільним рядком такого не знаходить — у назві між цими уривками
 * стоять інші слова. Тому кожен уривок шукається окремо, а товар підходить,
 * коли знайшлися всі.
 *
 * Збіг із початку слова важить більше за збіг усередині: «дро» в
 * «Дрогобицька» — те, що мали на увазі, а в «Ядро» — випадковість.
 */
function scoreOf(haystack: string, tokens: string[]): number | null {
  let score = 0
  for (const token of tokens) {
    const at = haystack.indexOf(token)
    if (at === -1) return null
    const atWordStart = at === 0 || haystack[at - 1] === ' '
    score += atWordStart ? 2 : 1
  }
  return score
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

  /* Готуємо рядок для пошуку раз на каталог, а не на кожну літеру */
  const index = useMemo(
    () => (catalogue ?? []).map(p => ({
      product: p,
      haystack: normalise([p.name, p.sku, p.code_1c].filter(Boolean).join(' ')),
    })),
    [catalogue],
  )

  const tokens = useMemo(
    () => normalise(query).split(' ').filter(t => t.length >= 2),
    [query],
  )

  const found = useMemo(() => {
    if (!tokens.length || !catalogue) return []
    const hits: { product: Product; score: number }[] = []

    for (const entry of index) {
      const score = scoreOf(entry.haystack, tokens)
      if (score != null) hits.push({ product: entry.product, score })
    }

    // Коротша назва за однакового збігу ближча до того, що шукали:
    // «Ковбаса "Дрогобицька"» перед «Ковбаса "Дрогобицька" нарізка в/у»
    hits.sort((a, b) => b.score - a.score || a.product.name.length - b.product.name.length)
    return hits.slice(0, 40).map(h => h.product)
  }, [index, tokens, catalogue])
  const searching = tokens.length > 0 && !catalogue

  function add(p: Product) {
    // Ваговий товар додається одним фасуванням, штучний — однією штукою:
    // саме так його й замовляють уголос
    const pack = p.pack ?? 0
    const qty = p.unit === 'кг' && pack > 0 ? pack : 1
    const key = `${p.id}-${Date.now()}`
    setAdded(key)
    onChange([...lines, {
      key,
      /*
       * Товар із Бітрікса нашого коду не має.
       *
       * Зате має свій номер у CRM — і саме він потрапить в угоду, а
       * звідти в 1С. Без нього рядок лишився б назвою, яку на складі
       * прочитають, а в обліку не впізнають.
       */
      product_id: p.source === 'bitrix' ? null : p.id,
      bitrix_product_id: p.bitrix_product_id ?? null,
      title: p.name,
      unit: p.unit,
      unit_weight: pack,
      price_per_unit: p.price,
      qty,
      // Ваговий товар за замовчуванням замовляють штуками — фасуваннями;
      // кілограми вмикають, коли клієнт називає вагу
      order_unit: p.unit === 'кг' && pack > 0 ? 'шт' : null,
      pieces: p.unit === 'кг' && pack > 0 ? 1 : null,
    }])
    // Порожній рядок пошуку ховає підказки сам — список рахується з нього
    setQuery('')
  }

  const patch = (key: string, next: Partial<Line>) =>
    onChange(lines.map(l => (l.key === key ? { ...l, ...next } : l)))

  /** Порожній рядок, у якому все вписує людина */
  function addBlank() {
    const key = `manual-${Date.now()}`
    setAdded(key)
    onChange([...lines, {
      key,
      product_id: null,
      bitrix_product_id: null,
      title: '',
      unit: 'кг',
      unit_weight: 0,
      price_per_unit: 0,
      qty: 1,
      order_unit: null,
      pieces: null,
    }])
  }

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
                className="w-full text-left px-3 py-2 min-h-11 lg:min-h-0
                           hover:bg-zinc-700 transition-colors
                           border-b border-zinc-700/50 last:border-0"
              >
                <div className="flex items-start gap-2">
                  {/*
                    * Знімок товару — ліворуч від назви.
                    *
                    * Назви в каталозі схожі до нерозрізнення: «Філе куряче»
                    * за 214 і «Філе куряче» за 378 — це грудка й мариноване.
                    * Оператор набирає зі слуху, і картинка розрізняє їх
                    * швидше, ніж артикул, який ще треба знати напам'ять.
                    *
                    * Місце під знімок тримається завжди, навіть коли його
                    * немає: інакше рядки з фото й без нього стоять уступом,
                    * і око спотикається на кожному.
                    */}
                  <span className="w-9 h-9 shrink-0 rounded bg-zinc-900 border border-zinc-700
                                   overflow-hidden flex items-center justify-center">
                    {p.image
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={p.image} alt="" loading="lazy"
                          className="w-full h-full object-cover" />
                      : <span className="text-zinc-700 text-sm">◰</span>}
                  </span>
                  <span className="text-white text-sm min-w-0 flex-1">{p.name}</span>
                  <span className="text-zinc-300 text-xs whitespace-nowrap">
                    {p.source === 'bitrix' && !p.price
                      ? <span className="text-amber-500">ціну вкажіть · {p.unit}</span>
                      : `${p.price} ₴/${p.unit}`}
                  </span>
                </div>
                <div className="text-zinc-500 text-xs mt-0.5 pl-11">
                  {p.source === 'bitrix'
                    ? (
                      <span className="text-zinc-400">
                        лише в Бітріксі
                        {p.price_from
                          ? ` · ціна з продажу ${p.price_from.split('-').reverse().slice(0, 2).join('.')}`
                          : p.price
                            ? ' · ціна ОНЛАЙН'
                            : ' · ціни немає — вкажіть'}
                      </span>
                    )
                    : (
                      /* Звідки товар, видно одразу: каталог сайту має ціну
                         й залишок, CRM — саму назву */
                      <>з сайту{p.sku ? ` · ${p.sku}` : ''}</>
                    )}
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

      <div className="flex items-center justify-between gap-2">
        <span className="text-zinc-400 text-xs">Замовлення</span>
        {/* Буває, що товару немає ніде — ні на сайті, ні в CRM: щойно
            розібрана туша, домовленість на вагу, разова позиція. Вписати
            її руками має бути можна, інакше замовлення складають у
            коментарі, а склад збирає з коментаря */}
        <button
          onClick={addBlank}
          className="text-zinc-500 hover:text-white text-xs transition-colors"
        >
          + Вписати вручну
        </button>
      </div>

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
                {l.product_id || l.bitrix_product_id ? (
                  <div className="text-white text-xs leading-snug">{l.title}</div>
                ) : (
                  /* Ручний рядок: назву читає комірник, тож вона має бути
                     такою, як її написала людина, а не підставленою */
                  <input
                    value={l.title}
                    onChange={e => patch(l.key, { title: e.target.value })}
                    placeholder="Назва позиції"
                    className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 min-h-11 lg:min-h-0
                               text-white text-xs placeholder-zinc-600
                               focus:outline-none focus:border-red-500"
                  />
                )}
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  {byPieces(l) ? (
                    <>
                      <NumField
                        value={l.pieces ?? 1}
                        autoFocus={l.key === added}
                        onChange={v => patch(l.key, {
                          pieces: v,
                          // Вага йде за штуками, поки її не виправили руками
                          qty: Math.round(v * (l.unit_weight || 0) * 1000) / 1000,
                        })}
                        className="w-16 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 min-h-11 lg:min-h-0
                                   text-white text-xs focus:outline-none focus:border-red-500"
                      />
                      <UnitToggle line={l} onPick={u => patch(l.key, toggleUnit(l, u))} />
                      <span className="text-zinc-600 text-xs">≈</span>
                      <NumField
                        value={l.qty}
                        onChange={v => patch(l.key, { qty: v })}
                        className="w-16 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 min-h-11 lg:min-h-0
                                   text-white text-xs focus:outline-none focus:border-red-500"
                      />
                      <span className="text-zinc-500 text-xs">кг</span>
                    </>
                  ) : (
                    <>
                      <NumField
                        value={l.qty}
                        autoFocus={l.key === added}
                        onChange={v => patch(l.key, { qty: v })}
                        className="w-20 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 min-h-11 lg:min-h-0
                                   text-white text-xs focus:outline-none focus:border-red-500"
                      />
                      {weighted(l)
                        ? <UnitToggle line={l} onPick={u => patch(l.key, toggleUnit(l, u))} />
                        : l.product_id
                          ? <span className="text-zinc-500 text-xs w-7">{l.unit}</span>
                          : (
                            /* Товар не з нашого каталогу — одиницю називає
                               людина: «голови курячі» беруть кілограмами,
                               а разову позицію можуть і штуками */
                            <select
                              value={l.unit}
                              onChange={e => patch(l.key, { unit: e.target.value })}
                              className="bg-zinc-900 border border-zinc-700 rounded px-1 py-1
                                         text-zinc-300 text-xs focus:outline-none
                                         focus:border-red-500"
                            >
                              <option value="кг">кг</option>
                              <option value="шт">шт</option>
                            </select>
                          )}
                    </>
                  )}
                  <span className="text-zinc-600 text-xs">×</span>
                  {/* Ціна товару з каталогу не редагується: замовлення не
                      місце для торгу, а розбіжність із сайтом потім нікому
                      не пояснити. Але там, де каталог її не дав — товар
                      лише в CRM або вписаний руками, — назвати її може
                      тільки людина. */}
                  {l.product_id ? (
                    <span className="text-zinc-300 text-xs tabular-nums">
                      {l.price_per_unit} ₴
                    </span>
                  ) : (
                    <>
                      <NumField
                        value={l.price_per_unit}
                        onChange={v => patch(l.key, { price_per_unit: v })}
                        className="w-16 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 min-h-11 lg:min-h-0
                                   text-white text-xs focus:outline-none focus:border-red-500"
                      />
                      <span className="text-zinc-500 text-xs">₴</span>
                    </>
                  )}
                  <span className="text-white text-xs ml-auto tabular-nums">
                    {money(l.qty * l.price_per_unit)}
                  </span>
                </div>
              </div>
              <button
                onClick={() => onChange(lines.filter(x => x.key !== l.key))}
                className="text-zinc-600 hover:text-red-400 text-xs shrink-0 transition-colors
                           w-11 h-11 lg:w-auto lg:h-auto"
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

/**
 * Deciding whether two product names are the same product, and what to do
 * about the price if they are.
 *
 * Matching by name is guesswork, so the guess is scored and shown. Nothing
 * here changes a price by itself: the page recommends, a person decides.
 */

import { contextQuery, contextMatches } from '@/lib/meat-context'

/** Words that say nothing about which product this is. */
const NOISE = new Set([
  'тм', 'тд', 'від', 'для', 'з', 'із', 'в', 'у', 'на', 'та', 'і', 'й', 'the',
  'продукт', 'товар', 'шт', 'уп', 'упаковка', 'пак', 'ваговий', 'ваговa',
])

/** Grams, kilograms, millilitres, litres — in grams or millilitres. */
const UNITS: Record<string, number> = {
  'г': 1, 'гр': 1, 'g': 1, 'мл': 1, 'ml': 1,
  'кг': 1000, 'kg': 1000, 'л': 1000, 'l': 1000,
}

export function normalizeTitle(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[«»"“”„'’`]/g, ' ')
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}.,]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The pack size, when the name states one.
 *
 * This matters more than it looks: «Тушонка, 500 г» and «Тушонка, 300 г» are
 * near-identical as text and are not the same offer. Comparing their prices
 * would produce a confident, wrong recommendation.
 */
export function extractAmount(raw: string): number | null {
  const text = normalizeTitle(raw)
  // A lookahead, not \b: the boundary is ASCII-only and never matched after a
  // Cyrillic unit, so every weight written in Ukrainian went unread and packs
  // of different sizes compared as if they were the same offer
  const m = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*(кг|kg|гр|г|мл|ml|л|l|g)(?![\p{L}\d])/gu)]
  if (!m.length) return null
  const last = m[m.length - 1]
  const value = Number(last[1].replace(',', '.'))
  if (!Number.isFinite(value)) return null
  return value * (UNITS[last[2]] ?? 1)
}

const tokens = (raw: string): string[] =>
  normalizeTitle(raw)
    .split(' ')
    .map(t => t.replace(/[.,]+$/, ''))
    .filter(t => t.length > 1 && !NOISE.has(t) && !/^\d+$/.test(t))

/** Dice coefficient over character bigrams — forgiving of endings and typos. */
function bigramDice(a: string, b: string): number {
  const grams = (s: string) => {
    const out = new Map<string, number>()
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2)
      out.set(g, (out.get(g) ?? 0) + 1)
    }
    return out
  }
  const ga = grams(a), gb = grams(b)
  if (!ga.size || !gb.size) return 0
  let shared = 0
  for (const [g, n] of ga) shared += Math.min(n, gb.get(g) ?? 0)
  return (2 * shared) / (a.length - 1 + b.length - 1)
}

/**
 * How alike two product names are, from 0 to 1.
 *
 * Word overlap and letter bigrams are averaged: the first catches "same words,
 * different order", the second survives a different case ending. A stated pack
 * size that disagrees cuts the score hard rather than zeroing it, so a wrong
 * match still surfaces for a person to reject instead of vanishing silently.
 */
/**
 * Two words meaning the same thing.
 *
 * Ukrainian inflects heavily, so testing words for equality is testing the
 * wrong thing: «куряче» and «курятини» are the same bird, «ковбаса» and
 * «ковбаски» the same sausage, and an exact-match test scores both pairs zero.
 * A shared stem is what actually carries the meaning.
 */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true
  const n = Math.min(a.length, b.length)
  if (n < 4) return false
  // Four letters is enough to tell «свин-» from «ялов-» while still joining
  // «куряч-» to «курят-»; less than that and «сир» would match «сирок» and
  // half the catalogue besides
  const stem = Math.min(n, a.length > 6 && b.length > 6 ? 5 : 4)
  return a.slice(0, stem) === b.slice(0, stem)
}

export function similarity(ours: string, theirs: string, mode: MatchMode = 'similar'): number {
  const a = tokens(ours), b = tokens(theirs)
  if (!a.length || !b.length) return 0

  const setB = new Set(b)
  const matched = new Set<string>()
  let overlap = 0
  for (const t of a) {
    const hit = b.find(o => !matched.has(o) && sameWord(t, o))
    if (hit) { matched.add(hit); overlap++ }
  }
  // Against the longer name, not the shorter one. Scoring against the shorter
  // rewards being a subset, which is how «Філе із курячого стегна» scored a
  // perfect overlap with «Філе куряче» — every word of ours is in theirs, and
  // the one word that makes it a different cut was free.
  const jaccard = overlap / Math.max(a.length, b.length)

  const dice = bigramDice(normalizeTitle(ours), normalizeTitle(theirs))
  let score = (jaccard + dice) / 2

  // What the product *is* — «Свинина», «Олія». Without this check «Свинина
  // тушкована» and «Яловичина тушкована» score as a confident match, because
  // everything except the one word that matters is identical.
  // Both ways. Checking only ours lets «Шашлик з курячого філе» through: our
  // «філе» appears in their name, so nothing objects — while what they are
  // selling is a kebab.
  const ourHead = a[0], theirHead = b[0]
  if (ourHead && !b.some(t => sameWord(ourHead, t))) score *= 0.55
  if (theirHead && !a.some(t => sameWord(theirHead, t))) score *= 0.55

  // Marinated, smoked, cooked — a real difference in product and in price,
  // but a near miss worth showing rather than hiding
  score *= contextMatches(ours, theirs).penalty || 1

  const amountA = extractAmount(ours), amountB = extractAmount(theirs)
  if (amountA && amountB) {
    const ratio = Math.min(amountA, amountB) / Math.max(amountA, amountB)
    if (ratio < 0.95) {
      // When sizes may be scaled, a different pack is not a different product —
      // it costs a little confidence, not the match. When they may not, it is
      // the wrong offer and scores accordingly.
      score *= MATCH_MODES[mode].allowScaling ? 0.88 : 0.4
    }
  }
  return Math.min(1, Math.round(score * 1000) / 1000)
}

/**
 * How strictly a given product should be matched.
 *
 * A jar of a named brand has exactly one counterpart on another site, and
 * anything else found under that name is noise. Mince, oil or sugar have no
 * single counterpart at all — there the question is what an equivalent pack
 * costs elsewhere, whoever makes it. One threshold cannot serve both.
 */
export const MATCH_MODES = {
  exact: {
    label: 'Точна позиція',
    hint: 'Той самий товар того самого виробника. Інше фасування не рахується.',
    floor: 0.60,
    trusted: 0.78,
    /** Whether 500 г may be compared with 1 кг by scaling the price */
    allowScaling: false,
  },
  similar: {
    label: 'Той самий товар',
    hint: 'Той самий товар будь-якого виробника. Різне фасування зводиться до нашого.',
    floor: 0.42,
    trusted: 0.62,
    allowScaling: true,
  },
  loose: {
    label: 'Схоже за складом',
    hint: 'Близька за суттю позиція — для товарів без прямого аналога. Більше збігів, більше ручної перевірки.',
    floor: 0.30,
    trusted: 0.48,
    allowScaling: true,
  },
} as const

export type MatchMode = keyof typeof MATCH_MODES
export const isMatchMode = (v: unknown): v is MatchMode =>
  typeof v === 'string' && v in MATCH_MODES

/** Used where a mode is not in play — the mid setting's numbers. */
export const MATCH_FLOOR = MATCH_MODES.similar.floor
export const MATCH_TRUSTED = MATCH_MODES.similar.trusted

/**
 * Their price at our pack size.
 *
 * This is the point of recording sizes. A rival selling 1 кг for 300 ₴ is not
 * dearer than our 500 г at 180 ₴ — they are cheaper, and comparing the two
 * printed numbers says the opposite. Returns null when either size is unknown,
 * because a guessed size would move the answer without saying so.
 */
export function scaleToOurPack(
  theirPrice: number,
  theirAmount: number | null,
  ourAmount: number | null,
): number | null {
  if (!theirAmount || !ourAmount || theirAmount <= 0 || ourAmount <= 0) return null
  return Math.round(theirPrice * (ourAmount / theirAmount) * 100) / 100
}

/**
 * Everything in hryvnia per kilogram.
 *
 * The only basis on which two shops can be compared. One prints 60 ₴ for a
 * 200 g tray, another 260 ₴ for a kilogram, and the printed numbers say the
 * first is four times cheaper when it is in fact more expensive:
 * 60 / 0.2 = 300 ₴/кг.
 *
 * Returns null when the weight is unknown — a guessed one would move the
 * answer without saying so, and a missing comparison is safer than a wrong one.
 */
export function pricePerKg(price: number, grams: number | null): number | null {
  if (!price || !grams || grams <= 0) return null
  return Math.round((price * 1000 / grams) * 100) / 100
}

/**
 * Our own price per kilogram.
 *
 * A name that states a weight — «Ковбаса, 430 г» — is a pack, and the price
 * belongs to that pack. A name that states none — «Філе куряче» — is sold by
 * weight, and the price already is per kilogram. Treating the second case as
 * "unknown" left every weight line without a comparable figure.
 */
export function ourPricePerKg(price: number, grams: number | null): number | null {
  if (!price) return null
  return grams ? pricePerKg(price, grams) : price
}

/**
 * What the printed price is per.
 *
 * `210.00 грн./кг` is already per kilogram; `371 грн /100г` is per hundred
 * grams; a plain price belongs to whatever weight the name states.
 */
export function unitGrams(text: string): number | null {
  const t = text.toLowerCase().replace(/\u00a0/g, ' ')
  // «/kg» as an API writes it, «грн./кг» as a page prints it
  if (/\/\s*кг|\/\s*kg\b|за\s+кг|грн\s*\.?\s*\/\s*кг/.test(t)) return 1000
  // A lookahead, not \b — the boundary is ASCII-only and never fires after a
  // Cyrillic «г», so «371 грн /100г» read as no unit at all
  const per = t.match(/\/\s*(\d{1,4})\s*(?:г|гр|мл)(?![\p{L}\d])/u)
  if (per) return Number(per[1])
  if (/\/\s*(?:г|гр)(?![\p{L}\d])/u.test(t)) return 1
  return null
}

/** «за 500 г» — how a scaled figure is labelled so nobody reads it as a price tag. */
export function amountLabel(grams: number | null): string | null {
  if (!grams) return null
  return grams >= 1000
    ? `${Number((grams / 1000).toFixed(2))} кг`
    : `${Math.round(grams)} г`
}

export type Verdict = 'expensive' | 'cheap' | 'aligned' | 'no_data'

export interface Advice {
  verdict: Verdict
  /** Our price minus the cheapest competitor, as a share of theirs */
  gapPct: number | null
  /** …and the same difference in hryvnia, which is what people act on */
  gapUah: number | null
  cheapest: number | null
  average: number | null
  /** What to change the price to, when changing it is worth suggesting */
  suggested: number | null
  /**
   * The gap is too large to be a market fact — almost certainly a unit
   * mismatch. No price is recommended in this state.
   */
  suspect: boolean
  reason: string
}

/** Where the line between noise and a problem sits. Editable on the page. */
export interface Thresholds {
  /** A gap smaller than this many hryvnia is noise, whatever the percentage */
  minAbs: number
  /** …and smaller than this share of their price is noise, whatever the sum */
  minPct: number
  /** How far under the cheapest rival a corrected price lands */
  undercutPct: number
}

export const DEFAULT_THRESHOLDS: Thresholds = { minAbs: 15, minPct: 5, undercutPct: 2 }

/**
 * Turns a set of competitor prices into one sentence a person can act on.
 *
 * A gap must clear both tests to count. Percentages on their own treat a 20 ₴
 * line and a 500 ₴ line alike; hryvnia on its own flags everything expensive.
 * Five hryvnia apart is not a pricing problem at any price, and a page that
 * says otherwise teaches people to ignore it.
 */
export function advise(
  ourPrice: number,
  prices: number[],
  t: Thresholds = DEFAULT_THRESHOLDS,
): Advice {
  const valid = prices.filter(p => Number.isFinite(p) && p > 0)
  if (!valid.length || !ourPrice) {
    return {
      verdict: 'no_data', gapPct: null, gapUah: null, cheapest: null, average: null,
      suggested: null, suspect: false, reason: 'Немає цін конкурентів',
    }
  }

  const cheapest = Math.min(...valid)
  const average = valid.reduce((s, p) => s + p, 0) / valid.length
  const gapUah = ourPrice - cheapest
  const gapPct = (gapUah / cheapest) * 100

  // A threefold gap is not a price war, it is a different unit of measure.
  // Silpo prints sausage per 100 г; read as a kilogram price it made our
  // 449 ₴/кг look 689% too dear and produced «знизьте до 56 ₴» — advice that
  // would be ruinous if anyone followed it. Better to say nothing and ask.
  const ratio = cheapest > 0 ? ourPrice / cheapest : 1
  if (ratio >= 3 || ratio <= 1 / 3) {
    return {
      verdict: 'no_data', gapPct, gapUah, cheapest, average,
      suggested: null, suspect: true,
      reason: `Розрив у ${ratio >= 3 ? ratio.toFixed(1) : (1 / ratio).toFixed(1)} раза`
        + ' — схоже на різні одиниці виміру, перевірте деталі',
    }
  }

  const matters = Math.abs(gapUah) >= t.minAbs && Math.abs(gapPct) >= t.minPct
  // Just under the cheapest, not far under: undercutting by more than it takes
  // gives away margin the price did not need to lose
  const target = Math.max(1, Math.round(cheapest * (1 - t.undercutPct / 100)))

  if (matters && gapUah > 0) {
    return {
      verdict: 'expensive', gapPct, gapUah, cheapest, average, suggested: target, suspect: false,
      reason: `Дорожче за найдешевшого на ${Math.round(gapUah)} ₴ (${gapPct.toFixed(0)}%)`,
    }
  }

  if (matters && gapUah < 0) {
    return {
      verdict: 'cheap', gapPct, gapUah, cheapest, average, suspect: false,
      suggested: target > ourPrice ? target : null,
      reason: `Дешевше за найдешевшого на ${Math.round(-gapUah)} ₴ (${Math.abs(gapPct).toFixed(0)}%) — є запас`,
    }
  }

  return {
    verdict: 'aligned', gapPct, gapUah, cheapest, average, suggested: null, suspect: false,
    reason: Math.abs(gapUah) < 1
      ? 'Ціна збігається з ринком'
      : `Різниця ${Math.round(Math.abs(gapUah))} ₴ — несуттєво`,
  }
}

export const VERDICT_META: Record<Verdict, { label: string; badge: string; dot: string }> = {
  expensive: { label: 'Дорого',     badge: 'bg-red-900/60 text-red-300',         dot: 'bg-red-500' },
  cheap:     { label: 'Дешево',     badge: 'bg-amber-900/60 text-amber-300',     dot: 'bg-amber-500' },
  aligned:   { label: 'В ринку',    badge: 'bg-emerald-900/60 text-emerald-300', dot: 'bg-emerald-500' },
  no_data:   { label: 'Немає даних', badge: 'bg-zinc-800 text-zinc-400',         dot: 'bg-zinc-600' },
}

/**
 * The same product asked for in progressively fewer words.
 *
 * Shop search is usually strict: «Філе куряче» returns nothing on a site that
 * happily returns seven results for «філе», because it has no item containing
 * both words. Sending only the full name therefore finds nothing almost
 * everywhere, which reads as "this competitor has no such product" when in
 * fact nobody asked properly.
 *
 * So we ask the way a person does — the whole name, then the essence of it,
 * then the single word that says what the thing is — and stop at the first
 * answer. Ranking the results is the matcher's job, not the search's.
 */
export function queryVariants(productName: string): string[] {
  const words = normalizeTitle(productName)
    .split(' ')
    .map(w => w.replace(/[.,]+$/, ''))
    .filter(w => w.length > 2 && !NOISE.has(w) && !/\d/.test(w))

  if (!words.length) return []

  // The head noun says what kind of thing it is — «ковбаса», «стегно». Every
  // shop has hundreds of those, so asking for it first returns a category.
  const head = words[0]
  // The distinctive word is what names this one: «Дрогобицька». Asking for it
  // first returns the few offers that can actually be the same product.
  const distinctive = words.slice(1).sort((a, b) => b.length - a.length)[0]

  // «стегно індички» rather than «стегно»: the cut alone returns every bird
  // in the shop, and the species is exactly what tells them apart
  const contextual = contextQuery(productName)

  const out = [
    contextual ?? '',
    distinctive,
    distinctive ? `${head} ${distinctive}` : '',
    normalizeTitle(productName).replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim(),
    words.slice(0, 2).join(' '),
    head,
  ]
  return [...new Set(out.filter(q => q.length > 2))]
}

/**
 * Is this offer the same kind of thing at all?
 *
 * Words first, then the trade's own vocabulary — see contextMatches, which is
 * what actually separates a turkey thigh from a chicken one.
 *
 * A gate, not a score. Searching «куряче» returns everything a poultry shop
 * sells, and a soft penalty still let «Чевапчічі курячі» sit in the details of
 * «Стегно куряче» looking like a comparison. What a product *is* has to match
 * before anything else is worth weighing.
 */
export function sameKind(ours: string, theirs: string): boolean {
  const a = tokens(ours), b = tokens(theirs)
  if (!a.length || !b.length) return false

  // Each side's head noun must appear on the other. Accepting any shared word
  // is not enough: «Стегно куряче» and «Чевапчічі курячі» share «куряч-» and
  // are not the same thing — the shared word is the bird, not the product.
  const inOther = (word: string, other: string[]) =>
    other.slice(0, 3).some(o => sameWord(word, o))

  if (!inOther(a[0], b) || !inOther(b[0], a)) return false

  // And the trade's own reading of both names. This is the check that knows a
  // turkey thigh is not a chicken thigh, however alike the two names look.
  return contextMatches(ours, theirs).ok
}

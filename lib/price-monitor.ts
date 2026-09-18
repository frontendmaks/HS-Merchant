/**
 * Deciding whether two product names are the same product, and what to do
 * about the price if they are.
 *
 * Matching by name is guesswork, so the guess is scored and shown. Nothing
 * here changes a price by itself: the page recommends, a person decides.
 */

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
export function similarity(ours: string, theirs: string, mode: MatchMode = 'similar'): number {
  const a = tokens(ours), b = tokens(theirs)
  if (!a.length || !b.length) return 0

  const setB = new Set(b)
  const overlap = a.filter(t => setB.has(t)).length
  const jaccard = overlap / new Set([...a, ...b]).size

  const dice = bigramDice(normalizeTitle(ours), normalizeTitle(theirs))
  let score = (jaccard + dice) / 2

  // What the product *is* — «Свинина», «Олія». Without this check «Свинина
  // тушкована» and «Яловичина тушкована» score as a confident match, because
  // everything except the one word that matters is identical.
  const head = a[0]
  if (head && !setB.has(head) && !b.some(t => t.startsWith(head.slice(0, 5)))) {
    score *= 0.55
  }

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
  cheapest: number | null
  average: number | null
  /** What to change the price to, when changing it is worth suggesting */
  suggested: number | null
  reason: string
}

/**
 * Turns a set of competitor prices into one sentence a person can act on.
 *
 * The bands are deliberately wide. A two-percent difference is not a pricing
 * problem, and a page that flags one teaches people to ignore it.
 */
export function advise(ourPrice: number, prices: number[]): Advice {
  const valid = prices.filter(p => Number.isFinite(p) && p > 0)
  if (!valid.length || !ourPrice) {
    return {
      verdict: 'no_data', gapPct: null, cheapest: null, average: null,
      suggested: null, reason: 'Немає цін конкурентів',
    }
  }

  const cheapest = Math.min(...valid)
  const average = valid.reduce((s, p) => s + p, 0) / valid.length
  const gapPct = ((ourPrice - cheapest) / cheapest) * 100

  if (gapPct > 10) {
    // Just under the cheapest, not far under: undercutting by a lot gives away
    // margin the price did not need to lose
    const suggested = Math.max(1, Math.round(cheapest * 0.98))
    return {
      verdict: 'expensive', gapPct, cheapest, average, suggested,
      reason: `Дорожче за найдешевшого на ${gapPct.toFixed(0)}%`,
    }
  }

  if (gapPct < -12) {
    // Room to raise, but only up to just under the cheapest rival
    const suggested = Math.round(cheapest * 0.97)
    return {
      verdict: 'cheap', gapPct, cheapest, average,
      suggested: suggested > ourPrice ? suggested : null,
      reason: `Дешевше за найдешевшого на ${Math.abs(gapPct).toFixed(0)}% — можна підняти`,
    }
  }

  return {
    verdict: 'aligned', gapPct, cheapest, average, suggested: null,
    reason: 'Ціна в ринку',
  }
}

export const VERDICT_META: Record<Verdict, { label: string; badge: string; dot: string }> = {
  expensive: { label: 'Дорого',     badge: 'bg-red-900/60 text-red-300',         dot: 'bg-red-500' },
  cheap:     { label: 'Дешево',     badge: 'bg-amber-900/60 text-amber-300',     dot: 'bg-amber-500' },
  aligned:   { label: 'В ринку',    badge: 'bg-emerald-900/60 text-emerald-300', dot: 'bg-emerald-500' },
  no_data:   { label: 'Немає даних', badge: 'bg-zinc-800 text-zinc-400',         dot: 'bg-zinc-600' },
}

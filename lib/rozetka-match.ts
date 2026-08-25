/**
 * Matching our catalogue against cards that already exist on Rozetka.
 *
 * A PriceCreator export gives no usable key: OFFERID and Артикул come back
 * empty on every row. The names line up, but the two systems disagree on
 * typography — curly quotes and apostrophes against straight ones, stray double
 * spaces — and Rozetka often carries a weight in the name that we keep in an
 * attribute. Both are folded away before comparing.
 */

/** Curly punctuation and runs of whitespace are noise, not meaning. */
export const foldName = (x: string) => (x ?? '')
  .replace(/[‘’ʼʹ`´]/g, "'")
  .replace(/[“”„«»]/g, '"')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase()

/** "Хінкалі «Східні», 500 г" -> "хінкалі "східні"" */
export const stripWeight = (x: string) =>
  x.replace(/,\s*[\d.,]+\s*(г|кг|мл|л|шт)\.?$/i, '').trim()

export interface Candidate {
  /** our WooCommerce product id */
  external_id: string
  name: string
}

export interface MatchInput {
  rozetka_id: string
  name: string
}

export interface MatchResult {
  matched: { external_id: string; rozetka_id: string; rozetka_name: string; matched_by: string }[]
  /** More than one of our products answers to the same name */
  ambiguous: { rozetka_id: string; name: string; candidates: string[] }[]
  /** Nothing in our catalogue answers to it */
  missing: { rozetka_id: string; name: string }[]
}

export function matchRozetkaCards(cards: MatchInput[], products: Candidate[]): MatchResult {
  const index = new Map<string, { p: Candidate; exact: boolean }[]>()
  const add = (key: string, p: Candidate, exact: boolean) => {
    const k = foldName(key)
    if (!k) return
    index.set(k, [...(index.get(k) ?? []), { p, exact }])
  }
  for (const p of products) {
    add(p.name, p, true)
    add(stripWeight(p.name ?? ''), p, false)
  }

  const out: MatchResult = { matched: [], ambiguous: [], missing: [] }
  const claimed = new Set<string>()

  for (const card of cards) {
    let hits: { p: Candidate; exact: boolean }[] = []
    let how = ''
    for (const [candidate, label] of [
      [card.name, 'name'], [stripWeight(card.name), 'name_no_weight'],
    ] as const) {
      const found = index.get(foldName(candidate)) ?? []
      if (found.length) { hits = found; how = label; break }
    }

    const unique = [...new Map(hits.map(h => [h.p.external_id, h.p])).values()]
      // A product already spoken for cannot answer for a second card
      .filter(p => !claimed.has(p.external_id))

    if (unique.length === 1) {
      claimed.add(unique[0].external_id)
      out.matched.push({
        external_id: unique[0].external_id,
        rozetka_id: card.rozetka_id,
        rozetka_name: card.name,
        matched_by: how,
      })
    } else if (unique.length > 1) {
      out.ambiguous.push({
        rozetka_id: card.rozetka_id, name: card.name,
        candidates: unique.map(p => `${p.external_id} — ${p.name}`),
      })
    } else {
      out.missing.push({ rozetka_id: card.rozetka_id, name: card.name })
    }
  }
  return out
}

/**
 * What a meat product actually is.
 *
 * Name similarity alone cannot tell «Стегно куряче» from «Стегно індиче»:
 * the words that differ are one short ending apart, and the rest matches
 * perfectly. For a butcher the two are not comparable at all — different bird,
 * different price, different shelf.
 *
 * So the matcher is given the vocabulary of the trade. Two names describe the
 * same product only when they agree on what animal it came from, which part of
 * it, and what was done to it. Everything else is scoring; this is a fact check.
 */

/** Stems, not words — Ukrainian inflects everything that follows them. */
const SPECIES: Record<string, string[]> = {
  курятина:  ['куряч', 'курк', 'курят', 'курин', 'курʼяч', 'бройлер'],
  індичка:   ['індич', 'індик', 'індюш'],
  свинина:   ['свин', 'свиняч', 'порос'],
  яловичина: ['ялович', 'ялов', 'телятин', 'теляч', 'бичк'],
  кролик:    ['кролик', 'кроляч', 'кроль'],
  баранина:  ['баран', 'ягнят', 'ягня'],
  качка:     ['качк', 'качин', 'кача'],
  гуска:     ['гуск', 'гусин', 'гуся'],
  риба:      ['лосос', 'форел', 'оселед', 'скумбр', 'тунц', 'риб'],
}

/** The part of the animal. */
const CUTS: Record<string, string[]> = {
  стегно:    ['стегн', 'окіст'],
  філе:      ['філе', 'філей'],
  крило:     ['крил'],
  гомілка:   ['гоміл'],
  грудка:    ['грудк', 'грудин'],
  вирізка:   ['вирізк', 'полядвиц'],
  шия:       ['ошийок', 'шия', 'шийн'],
  ребра:     ['ребр', 'ребер'],
  лопатка:   ['лопатк'],
  рулька:    ['рульк', 'голяшк'],
  корейка:   ['корейк', 'карбонад'],
  ніжка:     ['ніжк', 'лапк'],
  печінка:   ['печінк'],
  серце:     ['серц'],
  язик:      ['язик'],
  сало:      ['сало', 'шпик'],
}

/** What kind of thing it is, once it stops being a cut of meat. */
const FORMS: Record<string, string[]> = {
  ковбаса:    ['ковбас'],
  сосиски:    ['сосиск'],
  сардельки:  ['сардельк'],
  ковбаски:   ['ковбаск', 'купат', 'мерге', 'чевапчіч'],
  фарш:       ['фарш'],
  шашлик:     ['шашлик'],
  стейк:      ['стейк'],
  бекон:      ['бекон'],
  шинка:      ['шинк'],
  балик:      ['балик', 'бастурм'],
  паштет:     ['паштет'],
  консерви:   ['консерв', 'тушонк', 'тушков'],
  напівфабрикат: ['котлет', 'бифштекс', 'биточк', 'нагетс', 'крокет'],
  делікатес:  ['рулет', 'зельц', 'холодец'],
}

/** What was done to it — a real difference in product, and in price. */
const TREATMENT: Record<string, string[]> = {
  // «с/к» сирокопчена, «в/к» варено-копчена — these say how it was made.
  // «в/г» and «в/с» are grades, not treatments, and reading them as «варене»
  // made «Дрогобицька в/г» and «Дрогобицька ТЕР в/с» look differently made.
  копчене:    ['копчен', 'к/в', 'в/к', 'с/к'],
  варене:     ['варен'],
  сиров_ялене: ['сиров', 'вʼялен', 'вялен'],
  мариноване: ['маринад', 'маринован'],
  запечене:   ['запечен', 'печен'],
  сушене:     ['сушен', 'чипс'],
}

export interface MeatContext {
  species: string | null
  cut: string | null
  form: string | null
  treatment: string | null
}

const norm = (s: string) => s.toLowerCase()
  .replace(/[ʼ'’`]/g, 'ʼ')
  .replace(/[^\p{L}\p{N}ʼ/]+/gu, ' ')

function findIn(text: string, table: Record<string, string[]>): string | null {
  for (const [name, stems] of Object.entries(table)) {
    if (stems.some(stem => text.includes(stem))) return name
  }
  return null
}

/** Reads a product name as a butcher would. */
export function describe(name: string): MeatContext {
  const text = norm(name)
  return {
    species: findIn(text, SPECIES),
    cut: findIn(text, CUTS),
    form: findIn(text, FORMS),
    treatment: findIn(text, TREATMENT),
  }
}

export interface ContextVerdict {
  ok: boolean
  /** Why not, in words that go on the screen */
  reason: string | null
  /** A soft difference that lowers the score without rejecting the offer */
  penalty: number
}

/**
 * Do these two names describe the same product?
 *
 * Only a stated disagreement rejects. Silence does not: «Філе куряче» and
 * «Філе з курятини» both name the bird, while «Ковбаса Дрогобицька» names no
 * species at all and must still match its counterpart. Demanding that every
 * attribute be present would reject nearly everything a shop sells.
 */
export function contextMatches(ours: string, theirs: string): ContextVerdict {
  const a = describe(ours), b = describe(theirs)

  if (a.species && b.species && a.species !== b.species) {
    return { ok: false, reason: `інший вид м'яса: ${b.species}`, penalty: 0 }
  }
  if (a.cut && b.cut && a.cut !== b.cut) {
    return { ok: false, reason: `інший відруб: ${b.cut}`, penalty: 0 }
  }
  if (a.form && b.form && a.form !== b.form) {
    return { ok: false, reason: `інший тип продукту: ${b.form}`, penalty: 0 }
  }
  // A cut of raw meat against a made product — «Стегно куряче» against
  // «Ковбаса» — is not a price comparison, it is two different aisles
  if (a.cut && !b.cut && b.form && !a.form) {
    return { ok: false, reason: `це ${b.form}, а не відруб`, penalty: 0 }
  }
  if (b.cut && !a.cut && a.form && !b.form) {
    return { ok: false, reason: `це відруб, а не ${a.form}`, penalty: 0 }
  }

  // Processing is a real difference but a near miss: plain thigh against
  // marinated thigh is worth showing, marked, rather than hiding
  if (a.treatment !== b.treatment) {
    const what = b.treatment ?? 'без обробки'
    return { ok: true, reason: `обробка інша: ${what.replace('_', 'ʼ')}`, penalty: 0.75 }
  }

  return { ok: true, reason: null, penalty: 1 }
}

/** «курятина · стегно · копчене» — the context as a person reads it. */
export function contextLabel(name: string): string {
  const c = describe(name)
  return [c.species, c.cut, c.form, c.treatment?.replace('_', 'ʼ')]
    .filter(Boolean).join(' · ')
}

/**
 * Search terms that carry the context.
 *
 * Asking a shop for «стегно» returns every thigh it sells, of every bird.
 * Asking for «стегно індички» returns the one we are pricing. The species and
 * the cut together are what makes a query specific enough to be useful.
 */
export function contextQuery(name: string): string | null {
  const c = describe(name)
  const parts = [c.cut ?? c.form, c.species].filter(Boolean)
  return parts.length === 2 ? parts.join(' ') : null
}

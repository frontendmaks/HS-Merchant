/**
 * The note format for requests.
 *
 * Notes are written in a contenteditable box, which means the browser hands us
 * markup. Storing that markup and printing it back would put whatever the
 * browser (or a crafted request) produced straight into someone else's page.
 *
 * So nothing here is ever HTML. A note is a small tree of blocks and runs of
 * text, every field is checked against a closed list on the way in, and the
 * renderer builds React elements from it. Colour is a key from a palette, not
 * a CSS string, so there is nothing to inject even if the value is wrong.
 */

/** What a colour swatch means, resolved to a class at render time. */
export const NOTE_COLORS = {
  default: { label: 'Звичайний', css: 'inherit',   swatch: '#d4d4d8' },
  red:     { label: 'Червоний',  css: '#f87171',   swatch: '#f87171' },
  amber:   { label: 'Бурштин',   css: '#fbbf24',   swatch: '#fbbf24' },
  emerald: { label: 'Зелений',   css: '#34d399',   swatch: '#34d399' },
  cyan:    { label: 'Блакитний', css: '#22d3ee',   swatch: '#22d3ee' },
  violet:  { label: 'Фіолет',    css: '#a78bfa',   swatch: '#a78bfa' },
} as const

export type NoteColor = keyof typeof NOTE_COLORS
const COLOR_KEYS = Object.keys(NOTE_COLORS) as NoteColor[]

export interface NoteRun {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  color?: NoteColor
}

export type NoteBlock =
  | { type: 'p'; runs: NoteRun[] }
  | { type: 'li'; runs: NoteRun[] }
  /** `path` is a key in the private request-files bucket, never a URL */
  | { type: 'image'; path: string; name?: string }

/** Long enough for a real note, short enough that one cannot be a payload. */
const MAX_BLOCKS = 200
const MAX_RUNS = 200
const MAX_TEXT = 20_000

const isPath = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f-]{36}\/[a-z0-9-]{36}(\.[a-z0-9]{1,5})?$/i.test(v)

function cleanRun(raw: unknown): NoteRun | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.text !== 'string') return null

  const text = r.text.slice(0, MAX_TEXT)
  if (!text) return null

  const run: NoteRun = { text }
  if (r.bold === true) run.bold = true
  if (r.italic === true) run.italic = true
  if (r.underline === true) run.underline = true
  if (typeof r.color === 'string' && COLOR_KEYS.includes(r.color as NoteColor)
      && r.color !== 'default') {
    run.color = r.color as NoteColor
  }
  return run
}

/**
 * Accepts only what this format defines and drops the rest — an unknown block
 * type or a stray attribute never reaches storage, so it can never reach a
 * reader's page either.
 */
export function cleanNote(raw: unknown): NoteBlock[] {
  if (!Array.isArray(raw)) return []
  const out: NoteBlock[] = []

  for (const item of raw.slice(0, MAX_BLOCKS)) {
    if (!item || typeof item !== 'object') continue
    const b = item as Record<string, unknown>

    if (b.type === 'image') {
      if (!isPath(b.path)) continue
      const name = typeof b.name === 'string' ? b.name.slice(0, 120) : undefined
      out.push({ type: 'image', path: b.path, ...(name ? { name } : {}) })
      continue
    }

    if (b.type !== 'p' && b.type !== 'li') continue
    const runs = Array.isArray(b.runs)
      ? b.runs.slice(0, MAX_RUNS).map(cleanRun).filter((r): r is NoteRun => r !== null)
      : []
    out.push({ type: b.type, runs })
  }

  // Trailing empty paragraphs are what a contenteditable box leaves behind
  while (out.length) {
    const last = out[out.length - 1]
    if (last.type !== 'image' && last.runs.length === 0) out.pop()
    else break
  }
  return out
}

/** The same note as one line of text — for notifications, the journal, search. */
export function noteToPlain(blocks: NoteBlock[]): string {
  return blocks
    .map(b => b.type === 'image' ? `[зображення${b.name ? `: ${b.name}` : ''}]`
                                 : b.runs.map(r => r.text).join(''))
    .join('\n')
    .trim()
}

export const noteIsEmpty = (blocks: NoteBlock[]) =>
  !blocks.some(b => b.type === 'image' || b.runs.some(r => r.text.trim()))

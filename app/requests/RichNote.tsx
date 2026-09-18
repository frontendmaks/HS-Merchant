'use client'

/**
 * The note editor.
 *
 * A contenteditable box with a small toolbar. What the browser builds inside it
 * is markup, and markup is not what gets saved: on submit the DOM is walked and
 * turned into the blocks described in lib/rich-text.ts. Nothing that is not
 * part of that format survives the trip, whatever a browser or an extension
 * decided to leave in the box.
 */
import { useRef, useState } from 'react'
import { NOTE_COLORS, noteIsEmpty, type NoteBlock, type NoteColor, type NoteRun }
  from '@/lib/rich-text'

/** Marks carried down the tree while walking it. */
interface Marks { bold?: boolean; italic?: boolean; underline?: boolean; color?: NoteColor }

const COLOR_BY_CSS = new Map<string, NoteColor>(
  (Object.keys(NOTE_COLORS) as NoteColor[])
    .filter(k => k !== 'default')
    .map(k => [NOTE_COLORS[k].css.toLowerCase(), k]),
)

/** `rgb(248, 113, 113)` — what a browser reports instead of the hex we set. */
function colorFrom(value: string): NoteColor | undefined {
  const v = value.trim().toLowerCase()
  if (!v) return undefined
  if (COLOR_BY_CSS.has(v)) return COLOR_BY_CSS.get(v)

  const m = v.match(/^rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/)
  if (!m) return undefined
  const hex = '#' + [m[1], m[2], m[3]]
    .map(n => Number(n).toString(16).padStart(2, '0')).join('')
  return COLOR_BY_CSS.get(hex)
}

const BLOCK_TAGS = new Set(['DIV', 'P', 'LI', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'PRE'])

/** DOM in, note format out. */
function serialize(root: HTMLElement): NoteBlock[] {
  const blocks: NoteBlock[] = []
  let runs: NoteRun[] = []
  let listItem = false

  const flush = () => {
    if (runs.length) blocks.push({ type: listItem ? 'li' : 'p', runs })
    runs = []
  }

  const push = (text: string, marks: Marks) => {
    if (!text) return
    const last = runs[runs.length - 1]
    // Browsers split a styled word across several nodes; joining them back
    // keeps the stored note as short as what was typed
    if (last && !!last.bold === !!marks.bold && !!last.italic === !!marks.italic
        && !!last.underline === !!marks.underline && last.color === marks.color) {
      last.text += text
      return
    }
    runs.push({ text, ...marks })
  }

  const walk = (node: Node, marks: Marks) => {
    if (node.nodeType === Node.TEXT_NODE) {
      push((node.textContent ?? '').replace(/ /g, ' '), marks)
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return

    const el = node as HTMLElement

    if (el.tagName === 'BR') { push('\n', marks); return }

    if (el.tagName === 'IMG') {
      const path = el.dataset.path
      if (path) {
        flush()
        blocks.push({
          type: 'image', path,
          ...(el.dataset.name ? { name: el.dataset.name } : {}),
        })
      }
      return
    }

    const next: Marks = { ...marks }
    const style = el.style
    const weight = style.fontWeight || ''
    if (el.tagName === 'B' || el.tagName === 'STRONG'
        || weight === 'bold' || Number(weight) >= 600) next.bold = true
    if (el.tagName === 'I' || el.tagName === 'EM' || style.fontStyle === 'italic') next.italic = true
    if (el.tagName === 'U' || style.textDecoration.includes('underline')) next.underline = true

    const color = colorFrom(style.color || el.getAttribute('color') || '')
    if (color) next.color = color

    const isBlock = BLOCK_TAGS.has(el.tagName)
    if (isBlock) flush()
    const wasList = listItem
    if (el.tagName === 'LI') listItem = true

    el.childNodes.forEach(child => walk(child, next))

    if (isBlock) flush()
    listItem = wasList
  }

  root.childNodes.forEach(child => walk(child, {}))
  flush()
  return blocks
}

export default function RichNote({ requestId, onSubmit, busy }: {
  requestId: string
  onSubmit: (blocks: NoteBlock[]) => Promise<void>
  busy: boolean
}) {
  const box = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [empty, setEmpty] = useState(true)

  /** execCommand is on its way out but it is still the only thing every
   *  browser implements for this; the result is serialized, never trusted. */
  const cmd = (name: string, value?: string) => {
    box.current?.focus()
    document.execCommand(name, false, value)
    setEmpty(!box.current?.textContent?.trim() && !box.current?.querySelector('img'))
  }

  async function attach(file: File) {
    setError('')
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('request_id', requestId)
      const res = await fetch('/api/requests/files', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Не вдалося завантажити')

      const img = document.createElement('img')
      img.src = `/api/requests/files?path=${encodeURIComponent(data.file.path)}`
      img.dataset.path = data.file.path
      img.dataset.name = data.file.name
      img.className = 'max-h-64 rounded-lg my-1.5'
      box.current?.appendChild(img)
      box.current?.appendChild(document.createElement('br'))
      setEmpty(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  /** Pasting from a page brings its markup with it — take the text only. */
  function onPaste(e: React.ClipboardEvent) {
    const image = Array.from(e.clipboardData.files).find(f => f.type.startsWith('image/'))
    if (image) { e.preventDefault(); void attach(image); return }
    e.preventDefault()
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain'))
  }

  async function send() {
    if (!box.current) return
    const blocks = serialize(box.current)
    if (noteIsEmpty(blocks)) { setError('Нотатка порожня'); return }
    setError('')
    try {
      await onSubmit(blocks)
      box.current.innerHTML = ''
      setEmpty(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const tool = 'px-2 py-1 rounded text-xs text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors'

  return (
    <div>
      <div className="flex items-center gap-0.5 flex-wrap mb-1.5">
        <button type="button" onClick={() => cmd('bold')} className={`${tool} font-bold`} title="Жирний">Ж</button>
        <button type="button" onClick={() => cmd('italic')} className={`${tool} italic`} title="Курсив">К</button>
        <button type="button" onClick={() => cmd('underline')} className={`${tool} underline`} title="Підкреслений">П</button>
        <span className="w-px h-4 bg-zinc-700 mx-1" />
        <button type="button" onClick={() => cmd('insertUnorderedList')} className={tool} title="Список">• Список</button>
        <span className="w-px h-4 bg-zinc-700 mx-1" />
        {(Object.keys(NOTE_COLORS) as NoteColor[]).map(key => (
          <button
            key={key}
            type="button"
            title={NOTE_COLORS[key].label}
            onClick={() => cmd('foreColor', key === 'default' ? '#d4d4d8' : NOTE_COLORS[key].css)}
            className="w-5 h-5 rounded-full border border-zinc-600 hover:border-white transition-colors"
            style={{ background: NOTE_COLORS[key].swatch }}
          />
        ))}
        <span className="w-px h-4 bg-zinc-700 mx-1" />
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileInput.current?.click()}
          className={tool}
          title="Додати зображення"
        >
          {uploading ? 'Завантаження…' : '🖼 Фото'}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) void attach(f) }}
        />
      </div>

      <div className="relative">
        <div
          ref={box}
          contentEditable
          suppressContentEditableWarning
          onPaste={onPaste}
          onInput={() => setEmpty(
            !box.current?.textContent?.trim() && !box.current?.querySelector('img'))}
          className="w-full min-h-[76px] max-h-72 overflow-y-auto bg-zinc-800 border border-zinc-700
                     rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-red-500
                     [&_ul]:list-disc [&_ul]:pl-5 [&_img]:max-h-64 [&_img]:rounded-lg"
        />
        {empty && (
          <div className="absolute left-3 top-2 text-zinc-600 text-sm pointer-events-none">
            Нотатка — Enter робить новий абзац, Shift+Enter переносить рядок
          </div>
        )}
      </div>

      {error && <div className="text-red-400 text-xs mt-1.5">{error}</div>}

      <div className="flex justify-end mt-2">
        <button
          type="button"
          onClick={send}
          disabled={busy || uploading}
          className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white
                     text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
        >
          {busy ? 'Додається…' : 'Додати нотатку'}
        </button>
      </div>
    </div>
  )
}

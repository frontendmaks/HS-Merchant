'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * A small rich-text editor.
 *
 * Built on contentEditable and document.execCommand rather than an editor
 * library. execCommand is deprecated and every browser still implements it,
 * which for a panel that needs bold, colour, a link and a picture is the whole
 * requirement — a framework here would be several hundred kilobytes to do the
 * same thing. Whatever it produces is sanitised on the server before it is
 * stored, so the editor is never the thing keeping the HTML safe.
 */

const FONT_SIZES: { label: string; value: string }[] = [
  { label: 'Дрібний', value: '2' },
  { label: 'Звичайний', value: '3' },
  { label: 'Більший', value: '4' },
  { label: 'Великий', value: '5' },
  { label: 'Заголовок', value: '6' },
]

const COLORS = [
  '#ffffff', '#a1a1aa', '#09090b',
  '#dc2626', '#ea580c', '#d97706',
  '#059669', '#2563eb', '#7e22ce',
]

export default function Editor({ value, onChange }: {
  value: string
  onChange: (html: string) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  // Written in only when the editor is handed a different document. Feeding
  // every keystroke back would move the caret to the start on each letter.
  useEffect(() => {
    if (box.current && box.current.innerHTML !== value) {
      box.current.innerHTML = value
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const emit = () => onChange(box.current?.innerHTML ?? '')

  /** Keeps focus in the text: a toolbar button that steals it applies to nothing. */
  const run = (command: string, arg?: string) => (e: React.MouseEvent) => {
    e.preventDefault()
    box.current?.focus()
    document.execCommand(command, false, arg)
    emit()
  }

  const addLink = (e: React.MouseEvent) => {
    e.preventDefault()
    box.current?.focus()
    const url = window.prompt('Адреса посилання', 'https://')
    if (!url || !/^https?:\/\//i.test(url)) return
    document.execCommand('createLink', false, url)
    emit()
  }

  async function addImage(file: File) {
    setError('')
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/news/images', { method: 'POST', body: form })
      const data = await res.json() as { ok?: boolean; src?: string; error?: string }
      if (!data.ok || !data.src) throw new Error(data.error || 'Не вдалося завантажити')
      box.current?.focus()
      document.execCommand('insertImage', false, data.src)
      emit()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(false)
    }
  }

  const Btn = ({ onMouseDown, title, children, wide }: {
    onMouseDown: (e: React.MouseEvent) => void
    title: string
    children: React.ReactNode
    wide?: boolean
  }) => (
    <button
      type="button"
      title={title}
      onMouseDown={onMouseDown}
      className={`h-7 rounded text-zinc-300 hover:text-white hover:bg-zinc-700
                  transition-colors text-xs ${wide ? 'px-2' : 'w-7'}`}
    >
      {children}
    </button>
  )

  return (
    <div className="border border-zinc-700 rounded-lg overflow-hidden">
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 bg-zinc-800 border-b border-zinc-700">
        <Btn onMouseDown={run('bold')} title="Жирний"><b>Ж</b></Btn>
        <Btn onMouseDown={run('italic')} title="Курсив"><i>К</i></Btn>
        <Btn onMouseDown={run('underline')} title="Підкреслений"><u>П</u></Btn>
        <Btn onMouseDown={run('strikeThrough')} title="Закреслений"><s>З</s></Btn>

        <span className="w-px h-5 bg-zinc-700 mx-1" />

        <select
          defaultValue="3"
          onChange={e => { box.current?.focus(); document.execCommand('fontSize', false, e.target.value); emit() }}
          onMouseDown={e => e.stopPropagation()}
          className="h-7 bg-zinc-900 border border-zinc-700 rounded text-zinc-300 text-xs px-1"
          title="Розмір"
        >
          {FONT_SIZES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>

        <span className="w-px h-5 bg-zinc-700 mx-1" />

        <div className="flex items-center gap-0.5" title="Колір тексту">
          {COLORS.map(c => (
            <button
              key={c}
              type="button"
              onMouseDown={run('foreColor', c)}
              style={{ backgroundColor: c }}
              className="w-4 h-4 rounded-sm border border-zinc-600"
              aria-label={`Колір ${c}`}
            />
          ))}
        </div>

        <span className="w-px h-5 bg-zinc-700 mx-1" />

        <Btn onMouseDown={run('insertUnorderedList')} title="Список">•</Btn>
        <Btn onMouseDown={run('insertOrderedList')} title="Нумерований список">1.</Btn>
        <Btn onMouseDown={run('formatBlock', 'blockquote')} title="Цитата">❝</Btn>
        <Btn onMouseDown={addLink} title="Посилання">🔗</Btn>

        <label
          className="h-7 px-2 rounded text-zinc-300 hover:text-white hover:bg-zinc-700
                     transition-colors text-xs cursor-pointer flex items-center"
          title="Зображення"
        >
          {uploading ? '…' : '🖼'}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            disabled={uploading}
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) addImage(f)
              e.target.value = ''
            }}
          />
        </label>

        <span className="w-px h-5 bg-zinc-700 mx-1" />
        <Btn onMouseDown={run('removeFormat')} title="Прибрати форматування" wide>Очистити</Btn>
      </div>

      <div
        ref={box}
        contentEditable
        suppressContentEditableWarning
        onInput={emit}
        onBlur={emit}
        // Pasting from Word or a browser drags a wall of markup with it; taking
        // the plain text keeps the announcement looking like the panel
        onPaste={e => {
          e.preventDefault()
          const text = e.clipboardData.getData('text/plain')
          document.execCommand('insertText', false, text)
          emit()
        }}
        className="news-body min-h-[220px] max-h-[50vh] overflow-y-auto px-4 py-3
                   bg-zinc-900 text-zinc-200 text-sm focus:outline-none"
      />

      {error && <div className="px-4 py-2 text-red-400 text-xs border-t border-zinc-800">{error}</div>}
    </div>
  )
}

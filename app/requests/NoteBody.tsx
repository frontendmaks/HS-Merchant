'use client'

/**
 * Renders a stored note.
 *
 * Every element here is built by React from validated fields. There is no
 * dangerouslySetInnerHTML anywhere in this path, which is the whole point of
 * storing notes as data rather than as markup.
 */
import { NOTE_COLORS, type NoteBlock, type NoteRun } from '@/lib/rich-text'

function Run({ run }: { run: NoteRun }) {
  let node: React.ReactNode = run.text
  if (run.bold) node = <strong>{node}</strong>
  if (run.italic) node = <em>{node}</em>
  if (run.underline) node = <u>{node}</u>
  // The colour is a palette key, so what lands in the style is ours
  return run.color
    ? <span style={{ color: NOTE_COLORS[run.color].css }}>{node}</span>
    : <>{node}</>
}

export default function NoteBody({ blocks, plain }: {
  blocks: NoteBlock[] | null
  /** Notes written before the editor existed, and the fallback if one is empty */
  plain: string
}) {
  if (!blocks?.length) {
    return <div className="text-zinc-200 text-sm mt-0.5 whitespace-pre-wrap">{plain}</div>
  }

  return (
    <div className="text-zinc-200 text-sm mt-0.5 space-y-1">
      {blocks.map((b, i) => {
        if (b.type === 'image') {
          return (
            <a
              key={i}
              href={`/api/requests/files?path=${encodeURIComponent(b.path)}`}
              target="_blank"
              rel="noreferrer"
              className="block"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/requests/files?path=${encodeURIComponent(b.path)}`}
                alt={b.name ?? 'Зображення'}
                className="max-h-64 rounded-lg border border-zinc-700"
              />
            </a>
          )
        }

        const content = b.runs.map((r, j) => <Run key={j} run={r} />)
        return b.type === 'li'
          ? <div key={i} className="flex gap-2">
              <span className="text-zinc-600">•</span>
              <div className="whitespace-pre-wrap min-w-0">{content}</div>
            </div>
          : <div key={i} className="whitespace-pre-wrap">{content.length ? content : ' '}</div>
      })}
    </div>
  )
}

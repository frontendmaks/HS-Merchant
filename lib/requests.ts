// Shared vocabulary for work requests — used by the UI and the API routes.

export type RequestStatus =
  | 'new' | 'in_progress' | 'pending_review' | 'rework' | 'done' | 'canceled'
export type RequestPriority = 'low' | 'normal' | 'high' | 'urgent'

export interface RequestCategory {
  key: string
  label: string
  icon: string
  subjects: string[]
}

/** Ready-made subjects so the common asks are two clicks, not free typing.
 *  "Інше" keeps the door open for anything not listed. */
export const REQUEST_CATEGORIES: RequestCategory[] = [
  {
    key: 'products', label: 'Товари', icon: '◈',
    subjects: [
      'Видалити товар (виведено з асортименту)',
      'Додати новий товар',
      'Оновити ціну товару',
      'Оновити залишки',
      'Оновити фото або опис',
    ],
  },
  {
    key: 'site', label: 'Сайт', icon: '⊕',
    subjects: [
      'Вирішити проблему на сайті',
      'Оновити контент на сайті',
      'Додати банер або акцію',
    ],
  },
  {
    key: 'marketplace', label: 'Маркетплейси', icon: '⊞',
    subjects: [
      'Вирішити проблему на маркетплейсі',
      'Додати товар на маркетплейс',
      'Змінити ціну на маркетплейсі',
      'Оновити фід',
    ],
  },
  {
    key: 'platform', label: 'Платформа', icon: '▦',
    subjects: [
      'Покращити функціонал платформи',
      'Виправити помилку в платформі',
      'Додати новий звіт',
    ],
  },
  {
    key: 'packaging', label: 'Пакування', icon: '▤',
    subjects: [
      'Замовити термопакети',
      'Замовити термобокси',
      'Замовити пакувальні матеріали',
      'Замовити етикетки',
    ],
  },
  {
    key: 'production', label: 'Виробництво', icon: '⚙',
    subjects: [
      'Замовити товар на виробництві',
      'Змінити обсяг виробництва',
      'Перевірити терміни придатності',
    ],
  },
  {
    key: 'other', label: 'Інше', icon: '○',
    subjects: ['Інший запит'],
  },
]

export const categoryByKey = (key: string): RequestCategory | undefined =>
  REQUEST_CATEGORIES.find(c => c.key === key)

export const categoryLabel = (key: string): string =>
  categoryByKey(key)?.label ?? key

export const STATUS_META: Record<RequestStatus, { label: string; badge: string; dot: string }> = {
  new:            { label: 'Новий',            badge: 'bg-amber-950/60 text-amber-400',     dot: 'bg-amber-400' },
  in_progress:    { label: 'В роботі',         badge: 'bg-blue-950/60 text-blue-400',       dot: 'bg-blue-400' },
  pending_review: { label: 'На підтвердженні', badge: 'bg-purple-950/60 text-purple-300',   dot: 'bg-purple-400' },
  rework:         { label: 'На доопрацюванні', badge: 'bg-orange-950/60 text-orange-400',   dot: 'bg-orange-400' },
  done:           { label: 'Виконано',         badge: 'bg-emerald-950/60 text-emerald-400', dot: 'bg-emerald-400' },
  canceled:       { label: 'Скасовано',        badge: 'bg-zinc-800 text-zinc-500',          dot: 'bg-zinc-600' },
}

/** A request leaves the active lists only once it is signed off or dropped. */
export const isClosed = (status: string) => status === 'done' || status === 'canceled'

export const PRIORITY_META: Record<RequestPriority, { label: string; badge: string; rank: number }> = {
  urgent: { label: 'Терміново',  badge: 'bg-red-950/60 text-red-400',      rank: 3 },
  high:   { label: 'Високий',    badge: 'bg-orange-950/60 text-orange-400', rank: 2 },
  normal: { label: 'Звичайний',  badge: 'bg-zinc-800 text-zinc-400',       rank: 1 },
  low:    { label: 'Низький',    badge: 'bg-zinc-800/60 text-zinc-500',    rank: 0 },
}

export const STATUS_KEYS = Object.keys(STATUS_META) as RequestStatus[]
export const PRIORITY_KEYS = (Object.keys(PRIORITY_META) as RequestPriority[])
  .sort((a, b) => PRIORITY_META[b].rank - PRIORITY_META[a].rank)

/** Open requests come first, then most urgent, then nearest deadline.
 *  Requests without a deadline sort after those that have one. */
export function sortForInbox<T extends { status: string; priority: string; deadline: string | null; created_at: string }>(
  rows: T[]
): T[] {
  const openRank = (s: string) => (isClosed(s) ? 1 : 0)
  return [...rows].sort((a, b) => {
    const open = openRank(a.status) - openRank(b.status)
    if (open !== 0) return open

    const prio = (PRIORITY_META[b.priority as RequestPriority]?.rank ?? 0)
               - (PRIORITY_META[a.priority as RequestPriority]?.rank ?? 0)
    if (prio !== 0) return prio

    if (a.deadline && b.deadline) {
      if (a.deadline !== b.deadline) return a.deadline < b.deadline ? -1 : 1
    } else if (a.deadline !== b.deadline) {
      return a.deadline ? -1 : 1
    }
    return a.created_at < b.created_at ? 1 : -1
  })
}

/** How a deadline reads relative to today — drives the colour in the list. */
export function deadlineState(deadline: string | null, status: string, today = new Date()): {
  label: string
  tone: 'overdue' | 'today' | 'soon' | 'later' | 'none'
} {
  if (!deadline) return { label: 'Без дедлайну', tone: 'none' }

  const d = new Date(deadline + 'T00:00:00')
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const days = Math.round((d.getTime() - t.getTime()) / 86_400_000)
  const human = d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' })

  // A finished request is never "late"
  if (isClosed(status)) return { label: human, tone: 'later' }

  if (days < 0) return { label: `${human} · протерміновано на ${-days} дн.`, tone: 'overdue' }
  if (days === 0) return { label: `${human} · сьогодні`, tone: 'today' }
  if (days <= 3) return { label: `${human} · через ${days} дн.`, tone: 'soon' }
  return { label: human, tone: 'later' }
}

export const DEADLINE_TONE: Record<string, string> = {
  overdue: 'text-red-400',
  today:   'text-amber-400',
  soon:    'text-amber-500/80',
  later:   'text-zinc-500',
  none:    'text-zinc-600',
}

/** Supabase types an embedded to-one relation as an array even though the row
 *  comes back as a single object — collapse it so the UI can rely on one shape. */
function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function normalizeRequest(row: any) {
  return {
    ...row,
    author: one(row.author),
    // the join table wraps each person one level deep
    assignees: (row.assignees ?? []).map((a: any) => one(a.user)).filter(Boolean),
    notes: (row.notes ?? [])
      .map((n: any) => ({ ...n, author: one(n.author) }))
      .sort((a: any, b: any) => (a.created_at < b.created_at ? -1 : 1)),
    events: (row.events ?? [])
      .map((e: any) => ({ ...e, actor: one(e.actor) }))
      .sort((a: any, b: any) => (a.created_at < b.created_at ? -1 : 1)),
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Only the person who raised the request may re-prioritise it. */
export const canSetPriority = (request: { created_by: string }, userId: string) =>
  request.created_by === userId

export const NOTIFICATION_TYPES = {
  created:  'request_created',
  status:   'request_status',
  deadline: 'request_deadline',
  note:     'request_note',
  updated:  'request_updated',
  review:   'request_review',
} as const

// --- Journal --------------------------------------------------------------

export type RequestEventType =
  | 'created' | 'status' | 'priority' | 'deadline'
  | 'description' | 'note' | 'assignees' | 'confirmed' | 'returned'

export const EVENT_META: Record<RequestEventType, { label: string; icon: string }> = {
  created:     { label: 'створив запит',            icon: '✚' },
  status:      { label: 'змінив статус',            icon: '↻' },
  priority:    { label: 'змінив пріоритет',         icon: '⚑' },
  deadline:    { label: 'змінив дедлайн',           icon: '◷' },
  description: { label: 'змінив опис',              icon: '✎' },
  note:        { label: 'додав нотатку',            icon: '✎' },
  assignees:   { label: 'змінив виконавців',        icon: '◉' },
  confirmed:   { label: 'підтвердив виконання',     icon: '✓' },
  returned:    { label: 'повернув на доопрацювання', icon: '↩' },
}

/** Renders a stored value for the journal — raw keys mean nothing to a reader. */
export function eventValue(type: string, value: string | null): string | null {
  if (!value) return null
  if (type === 'status') return STATUS_META[value as RequestStatus]?.label ?? value
  if (type === 'priority') return PRIORITY_META[value as RequestPriority]?.label ?? value
  if (type === 'deadline') return new Date(value + 'T00:00:00').toLocaleDateString('uk-UA')
  return value
}

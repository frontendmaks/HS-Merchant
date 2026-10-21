/**
 * Доступ до Trello.
 *
 * Дошка «Моніторинг МЕ» — це конвеєр доставки, і картки на ній створює
 * чинна інтеграція, не ми. Наша справа скромніша: дописати в картку те,
 * чого в ній бракує, — номер ящика й посилання на бланк.
 */
const BASE = 'https://api.trello.com/1'

export const trelloConfigured = () =>
  !!process.env.TRELLO_KEY && !!process.env.TRELLO_TOKEN

export class TrelloError extends Error {}

async function call<T>(
  method: 'GET' | 'PUT' | 'POST',
  path: string,
  params: Record<string, string> = {},
): Promise<T> {
  const query = new URLSearchParams({
    ...params,
    key: process.env.TRELLO_KEY ?? '',
    token: process.env.TRELLO_TOKEN ?? '',
  })

  const res = await fetch(`${BASE}${path}?${query}`, {
    method,
    signal: AbortSignal.timeout(20_000),
  })

  if (!res.ok) {
    throw new TrelloError(`${method} ${path} → ${res.status} ${(await res.text()).slice(0, 200)}`)
  }
  return await res.json() as T
}

export interface TrelloCard {
  id: string
  name: string
  desc: string
  idList: string
  shortUrl: string
  pos: number
}

export const listCards = (listId: string) =>
  call<TrelloCard[]>('GET', `/lists/${listId}/cards`, { fields: 'name,desc,idList,shortUrl,pos' })

export const updateCard = (
  cardId: string,
  fields: { name?: string; desc?: string; idList?: string; pos?: number | string },
) => call<TrelloCard>('PUT', `/cards/${cardId}`, fields as Record<string, string>)

export interface TrelloList {
  id: string
  name: string
}

export const boardLists = (boardId: string) =>
  call<TrelloList[]>('GET', `/boards/${boardId}/lists`, { fields: 'name' })

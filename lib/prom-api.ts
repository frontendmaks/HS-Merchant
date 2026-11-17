/**
 * Prom.ua — публічне API продавця.
 *
 * Головна відмінність від Rozetka, і на ній тримається вся інтеграція:
 * **через API товар створити не можна**. Довідка Prom каже прямо —
 * «додати товари вручну або через імпорт; оновлювати існуючі товари
 * також можна за API». Тобто API вміє читати й правити те, що вже є,
 * а заводяться товари імпортом файлу або посилання на фід.
 *
 * Тому тут немає нічого схожого на items-create: заведення асортименту
 * робить фід (lib/prom-feed.ts), а це — ціни, залишки й замовлення.
 *
 * Токен постійний, живе рік і лежить у PROM_TOKEN. Генерується в
 * кабінеті: Налаштування → Управління API-токенами.
 */
const BASE = process.env.PROM_BASE || 'https://my.prom.ua/api/v1'

import { isTest, heldBack } from '@/lib/env-mode'

async function prom<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (isTest && method !== 'GET') {
    heldBack('Prom', `${method} ${path}`, body)
    return {} as T
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.PROM_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok || data?.error) {
    throw new Error(`Prom API ${res.status}: ${data?.error ?? JSON.stringify(data).slice(0, 300)}`)
  }
  return data as T
}

export interface PromOrder {
  id: number
  date_created: string
  date_modified: string | null
  client_first_name: string | null
  client_last_name: string | null
  client_second_name: string | null
  phone: string | null
  email: string | null
  delivery_option: { id: number; name: string } | null
  delivery_address: string | null
  delivery_cost: number | null
  payment_option: { id: number; name: string } | null
  price: string | number | null
  full_price: string | number | null
  client_notes: string | null
  status: string
  status_name: string | null
  cancellation: { reason?: string | null; text?: string | null } | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  products: any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

export interface PromProduct {
  id: number
  external_id: string | null
  name: string
  sku: string | null
  presence: string
  price: number | string | null
  status: string
  quantity_in_stock: number | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

/**
 * Сторінками, через last_id.
 *
 * Prom не має номерів сторінок: наступна порція береться від
 * останнього побаченого id. Без цього видно лише перші сто.
 */
async function paged<T extends { id: number }>(
  path: string, key: string, limit = 100, cap = 5000,
): Promise<T[]> {
  const out: T[] = []
  let lastId = 0
  for (;;) {
    const sep = path.includes('?') ? '&' : '?'
    const page = await prom<Record<string, T[]>>(
      'GET', `${path}${sep}limit=${limit}${lastId ? `&last_id=${lastId}` : ''}`)
    const rows = page[key] ?? []
    out.push(...rows)
    if (rows.length < limit || out.length >= cap) break
    lastId = rows[rows.length - 1].id
  }
  return out
}

/** Замовлення, змінені з цієї дати (YYYY-MM-DD). Без дати — всі. */
export async function promOrders(since?: string): Promise<PromOrder[]> {
  return paged<PromOrder>(
    `/orders/list${since ? `?date_from=${since}` : ''}`, 'orders')
}

export async function promOrder(id: number): Promise<PromOrder> {
  const r = await prom<{ order: PromOrder }>('GET', `/orders/${id}`)
  return r.order
}

export async function promProducts(): Promise<PromProduct[]> {
  return paged<PromProduct>('/products/list', 'products')
}

/** Статус замовлення. Prom приймає список id одним викликом. */
export async function promSetOrderStatus(
  ids: number[], status: string, cancellationReason?: string,
): Promise<void> {
  await prom('POST', '/orders/set_status', {
    ids, status,
    ...(cancellationReason ? { cancellation_reason: cancellationReason } : {}),
  })
}

/**
 * Ціна й залишок наявних товарів.
 *
 * Той самий виклик правит і ціну, і наявність, і кількість — і це
 * єдине, що ми через API змінюємо: решта картки приїжджає фідом, і
 * правити її ще й тут означало б два господарі в одного поля.
 */
export interface PromPriceUpdate {
  id: number
  price?: number
  presence?: 'available' | 'not_available'
  quantity_in_stock?: number
}

export async function promUpdateProducts(items: PromPriceUpdate[]): Promise<number> {
  if (!items.length) return 0
  const r = await prom<{ processed_ids?: number[] }>('POST', '/products/edit', items)
  return r.processed_ids?.length ?? items.length
}

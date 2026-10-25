'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ORDERS_TOPIC, type OrderChangeKind } from '@/lib/order-broadcast'

export interface OrderChange {
  orderId: string
  kind: OrderChangeKind
  at: string
}

/**
 * Calls back when any order changes anywhere.
 *
 * The callback is held in a ref so a caller need not memoise it — passing an
 * inline function would otherwise tear the subscription down and rebuild it on
 * every render, and the moment between the two is when a notice goes missing.
 */

/**
 * All listeners in a tab share one subscription.
 *
 * Every caller used to open a channel of its own, which on the orders list
 * meant one per row: forty sockets carrying the same handful of messages.
 * The channel now opens with the first listener and closes with the last.
 */
type Listener = (change: OrderChange) => void

const listeners = new Set<Listener>()
let channel: ReturnType<ReturnType<typeof createClient>['channel']> | null = null

function open() {
  if (channel) return
  const client = createClient()
  channel = client
    .channel(ORDERS_TOPIC)
    .on('broadcast', { event: 'changed' }, ({ payload }: { payload: OrderChange }) => {
      const c = payload as OrderChange
      if (c?.orderId) listeners.forEach(fn => fn(c))
    })
    .subscribe()
}

function close() {
  if (!channel || listeners.size) return
  createClient().removeChannel(channel)
  channel = null
}

export function useOrderUpdates(onChange: (change: OrderChange) => void): void {
  const handler = useRef(onChange)
  handler.current = onChange

  useEffect(() => {
    const listener: Listener = c => handler.current(c)
    listeners.add(listener)
    open()
    return () => {
      listeners.delete(listener)
      close()
    }
  }, [])
}

/**
 * Те саме, але не частіше ніж раз на кілька секунд.
 *
 * Синхронізація сповіщає про кожне замовлення окремо — за один прохід це
 * сотня повідомлень поспіль. Сторінка, яка перечитує себе на кожне з них,
 * перестає відповідати на натискання: сто запитів до сервера стають у чергу
 * попереду того, що хотіла людина.
 *
 * Тут важить не кожна подія, а те, що щось змінилось: одне перечитування
 * після затишшя показує рівно те саме, що сто.
 */
export function useOrderUpdatesThrottled(
  onChange: () => void,
  quietMs = 2500,
): void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handler = useRef(onChange)
  handler.current = onChange

  useOrderUpdates(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => handler.current(), quietMs)
  })

  /*
   * Страховка на випадок, коли сповіщення не прийшло.
   *
   * Список перечитував себе лише на повідомлення з каналу. Канал живе
   * сокетом, а сокет рветься мовчки: телефон заснув, вкладка пішла у
   * фон, мережа моргнула — і сторінка лишається такою, якою була
   * годину тому. З боку оператора це виглядає як відсутня
   * синхронізація: замовлення в Бітріксі є, а «в Мерчанті його немає»,
   * хоч у базі воно вже дві секунди як лежить.
   *
   * Тому перечитуємо ще й самі: коли вкладка повертається на очі й раз
   * на хвилину просто так. Сторінка читається з бази одним запитом,
   * тож хвилинний такт нічого не коштує, зате старіших за хвилину
   * даних на екрані більше не буває.
   */
  useEffect(() => {
    const refresh = () => handler.current()

    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', refresh)

    const beat = setInterval(() => {
      // У фоні перечитувати нема для кого — зробимо це, щойно повернуться
      if (document.visibilityState === 'visible') refresh()
    }, 60_000)

    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', refresh)
      clearInterval(beat)
    }
  }, [])
}

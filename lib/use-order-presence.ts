'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * Хто ще відкрив це замовлення.
 *
 * Замовлення №45 за 31 жовтня правили вдвох, не знаючи одна про одну: Оля
 * зберегла склад «Панська Гора» й поставила замовлення на комплектацію, а
 * Анна за чотири секунди зберегла «М10». Виграла остання, і це нормально —
 * ненормально, що жодна з них не бачила другої. Бланк тоді пішов не на той
 * склад, але так само тихо могли затертись адреса чи позиції.
 *
 * Тут немає замків і попереджень: лише видно, що картка в кого ще
 * відкрита. Далі домовляються голосом — вони сидять поруч.
 *
 * Присутність, а не таблиця: запис про відкриту картку живе рівно стільки,
 * скільки живе вкладка. Вкладку закрили, ноутбук заснув, мережа впала —
 * запис зникає сам, і ніхто не лишається «назавжди в картці».
 */

const TOPIC = 'order-viewers'

export interface Viewer { id: string; name: string }

interface Presence { id: string; name: string; orders: string[] }

type Channel = ReturnType<ReturnType<typeof createClient>['channel']>

let channel: Channel | null = null
let me: Viewer | null = null

/** Скільки вікон правки відкрито на кожне замовлення в цій вкладці */
const mine = new Map<string, number>()
/** orderId → імена інших людей, що тримають його відкритим */
let others: Record<string, string[]> = {}

const listeners = new Set<() => void>()
const tell = () => listeners.forEach(fn => fn())

function read() {
  if (!channel) return
  const state = channel.presenceState() as unknown as Record<string, Presence[]>
  const next: Record<string, string[]> = {}

  for (const entries of Object.values(state ?? {})) {
    for (const who of entries ?? []) {
      if (!who?.id || who.id === me?.id) continue
      for (const orderId of who.orders ?? []) {
        const names = (next[orderId] ??= [])
        // Одна людина в двох вкладках — це все одно одна людина
        if (!names.includes(who.name)) names.push(who.name)
      }
    }
  }

  others = next
  tell()
}

function announce() {
  void channel?.track({ id: me?.id, name: me?.name, orders: [...mine.keys()] })
}

function open(who: Viewer) {
  me = who
  if (channel) return

  channel = createClient()
    .channel(TOPIC, { config: { presence: { key: who.id } } })
    .on('presence', { event: 'sync' }, read)
    .subscribe((status: string) => { if (status === 'SUBSCRIBED') announce() })
}

/**
 * Поки вікно правки відкрите — інші це бачать.
 *
 * Лічильник, а не прапорець: те саме замовлення можна відкрити двічі, і
 * закриття одного вікна не має прибирати позначку, поки друге живе.
 */
export function useViewingOrder(orderId: string, who: Viewer | null): void {
  useEffect(() => {
    if (!who?.id) return
    open(who)
    mine.set(orderId, (mine.get(orderId) ?? 0) + 1)
    announce()

    return () => {
      const left = (mine.get(orderId) ?? 1) - 1
      if (left > 0) mine.set(orderId, left)
      else mine.delete(orderId)
      announce()
    }
    /* Саме id та ім'я, а не сам об'єкт: список віддає його з сервера,
       і кожен рендер приносить новий — на нього підписка перезбиралась би
       без кінця */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, who?.id, who?.name])
}

/** Імена тих, хто тримає це замовлення відкритим — окрім мене. */
export function useOrderViewers(orderId: string, who: Viewer | null): string[] {
  const [names, setNames] = useState<string[]>([])

  useEffect(() => {
    if (!who?.id) return
    open(who)

    const listener = () => setNames(others[orderId] ?? [])
    listeners.add(listener)
    listener()

    return () => { listeners.delete(listener) }
    /* Саме id та ім'я, а не сам об'єкт: список віддає його з сервера,
       і кожен рендер приносить новий — на нього підписка перезбиралась би
       без кінця */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, who?.id, who?.name])

  return names
}

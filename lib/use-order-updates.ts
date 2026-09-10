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

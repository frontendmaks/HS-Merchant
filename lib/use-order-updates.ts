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
export function useOrderUpdates(onChange: (change: OrderChange) => void): void {
  const handler = useRef(onChange)
  handler.current = onChange

  useEffect(() => {
    const client = createClient()
    const channel = client
      .channel(ORDERS_TOPIC)
      .on('broadcast', { event: 'changed' }, ({ payload }) => {
        const c = payload as OrderChange
        if (c?.orderId) handler.current(c)
      })
      .subscribe()

    return () => { client.removeChannel(channel) }
  }, [])
}

'use client'

import { useEffect, useState } from 'react'
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'

/** Shared Realtime channel every signed-in tab joins. */
export const PRESENCE_CHANNEL = 'online-users'

type Listener = (ids: Set<string>) => void

// One channel per tab, shared by every consumer. Two channels on the same topic
// would fight over the socket, so the same subscription both announces this user
// and reports everyone else — which is also why you can see yourself online.
let client: SupabaseClient | null = null
let channel: RealtimeChannel | null = null
let channelUserId: string | null = null
let refs = 0
let online: Set<string> = new Set()
const listeners = new Set<Listener>()

function sync() {
  if (!channel) return
  // presence key is the user id
  online = new Set(Object.keys(channel.presenceState()))
  const snapshot = new Set(online)
  listeners.forEach(fn => fn(snapshot))
}

function open(userId: string) {
  client = createClient()
  channelUserId = userId
  const ch = client.channel(PRESENCE_CHANNEL, {
    config: { presence: { key: userId } },
  })
  channel = ch
  ch.on('presence', { event: 'sync' }, sync)
    .on('presence', { event: 'join' }, sync)
    .on('presence', { event: 'leave' }, sync)
    .subscribe(status => {
      if (status === 'SUBSCRIBED') {
        ch.track({ user_id: userId, online_at: new Date().toISOString() })
      }
    })
}

function close() {
  if (client && channel) client.removeChannel(channel)
  client = null
  channel = null
  channelUserId = null
  online = new Set()
}

const PING_MS = 3 * 60 * 1000

/** Marks `userId` online while mounted, and returns everyone currently online.
 *  Mount it in the Sidebar so presence follows the user across every page;
 *  other components may call it too — they all share the one channel. */
export function usePresence(userId: string | null | undefined): Set<string> {
  const [ids, setIds] = useState<Set<string>>(() => new Set(online))

  // Records "last seen" server-side; the channel above only knows who is
  // connected right now.
  useEffect(() => {
    if (!userId) return
    const ping = () => { void fetch('/api/presence/ping', { method: 'POST' }).catch(() => {}) }
    ping()
    const timer = setInterval(ping, PING_MS)
    return () => clearInterval(timer)
  }, [userId])

  useEffect(() => {
    if (!userId) return
    listeners.add(setIds)
    refs++

    if (!channel || channelUserId !== userId) {
      close()
      open(userId)
    } else {
      setIds(new Set(online))
    }

    return () => {
      listeners.delete(setIds)
      refs = Math.max(0, refs - 1)
      // Sidebar keeps a ref for the whole session, so this only fires on sign-out
      if (refs === 0) close()
    }
  }, [userId])

  return ids
}

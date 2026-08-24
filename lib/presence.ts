'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

/** Shared Realtime channel every signed-in tab joins. */
export const PRESENCE_CHANNEL = 'online-users'

type PresenceRow = { user_id: string }

/** Announce this tab as online for as long as it stays open.
 *  Mount once app-wide (Sidebar) — closing the tab drops the socket and
 *  Realtime removes the entry, so no heartbeat or cleanup job is needed. */
export function useTrackPresence(userId: string | null | undefined) {
  useEffect(() => {
    if (!userId) return
    const supabase = createClient()
    const channel = supabase.channel(PRESENCE_CHANNEL, {
      config: { presence: { key: userId } },
    })

    channel.subscribe(status => {
      if (status === 'SUBSCRIBED') {
        channel.track({ user_id: userId } satisfies PresenceRow)
      }
    })

    return () => { supabase.removeChannel(channel) }
  }, [userId])
}

/** Read-only view of who is currently online. */
export function useOnlineUsers(): Set<string> {
  const [online, setOnline] = useState<Set<string>>(new Set())

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase.channel(PRESENCE_CHANNEL)

    const sync = () => {
      const state = channel.presenceState<PresenceRow>()
      const ids = new Set<string>()
      for (const [key, entries] of Object.entries(state)) {
        // presence key is the user id; fall back to the tracked payload
        ids.add(key || entries[0]?.user_id)
      }
      ids.delete(undefined as unknown as string)
      setOnline(ids)
    }

    channel
      .on('presence', { event: 'sync' }, sync)
      .on('presence', { event: 'join' }, sync)
      .on('presence', { event: 'leave' }, sync)
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  return online
}

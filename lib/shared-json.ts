'use client'

type Entry = { value?: unknown; at: number; pending?: Promise<unknown>; channel?: BroadcastChannel }
const entries = new Map<string, Entry>()
/** Share read-only polling across components and same-user tabs; no persisted payloads. */
export async function sharedJson<T>(url: string, userId: string, ttl: number): Promise<T> {
  const key = `hs:${userId}:${url}`
  let entry = entries.get(key)
  if (!entry) {
    entry = { at: 0 }
    entries.set(key, entry)
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(key)
      entry.channel = channel
      const current = entry
      channel.onmessage = ({ data }) => {
        if (data?.kind === 'value' && typeof data.at === 'number' && data.at > current.at) {
          current.at = data.at; current.value = data.value
        } else if (data?.kind === 'request' && current.value !== undefined && Date.now() - current.at < ttl) {
          channel.postMessage({ kind: 'value', at: current.at, value: current.value })
        }
      }
    }
  }
  const current = entry
  const read = async () => {
    if (current.value !== undefined && Date.now() - current.at < ttl) return current.value as T
    current.channel?.postMessage({ kind: 'request' })
    // Give an already-open tab a chance to answer from memory.
    await new Promise(resolve => setTimeout(resolve, 40))
    if (current.value !== undefined && Date.now() - current.at < ttl) return current.value as T
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const value = await res.json() as T
    current.value = value; current.at = Date.now()
    current.channel?.postMessage({ kind: 'value', at: current.at, value })
    return value
  }
  if (!current.pending) {
    current.pending = (navigator.locks
      ? navigator.locks.request(key, read)
      : read()).finally(() => { current.pending = undefined })
  }
  return current.pending as Promise<T>
}

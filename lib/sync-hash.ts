import { createHash } from 'crypto'

/**
 * A fingerprint of the row sync would write.
 *
 * Both marketplaces hand back their whole recent window every few minutes, and
 * we used to store all of it every time — around ninety rows every five
 * minutes, each carrying its full raw payload. Postgres rewrites a row for any
 * update, so an order that had not changed since June was still costing a page
 * write, a WAL record and, later, a vacuum. Multiplied across the day that was
 * most of the disk traffic on the instance.
 *
 * `updated_at` is deliberately excluded: it is set to now() on every pass, so
 * including it would make every row look different and defeat the whole point.
 */
export function syncHash(row: Record<string, unknown>): string {
  const keys = Object.keys(row).filter(k => k !== 'updated_at' && k !== 'sync_hash').sort()
  return createHash('sha1').update(JSON.stringify(row, keys)).digest('hex')
}

/** Splits rows into those worth writing and those already stored as-is. */
export function changedRows<T extends Record<string, unknown> & { external_id: string }>(
  rows: T[],
  storedHashes: Map<string, string>,
): (T & { sync_hash: string })[] {
  const out: (T & { sync_hash: string })[] = []
  for (const row of rows) {
    const hash = syncHash(row)
    if (storedHashes.get(row.external_id) === hash) continue
    out.push({ ...row, sync_hash: hash })
  }
  return out
}

/**
 * MauDau API helpers — shared across all API routes.
 *
 * JWT caching strategy (two layers):
 *  1. Module-level in-memory cache — zero-latency for warm function instances.
 *  2. Supabase `app_tokens` table — shared across ALL cold-start instances so
 *     we never call /login more than once per 23 hours regardless of how many
 *     concurrent Vercel functions spin up.
 *
 * Endpoints (from spec / Code.gs):
 *   Status change : PATCH /v1/merchant_public_api/orders/{id}/status  { status, cancellation_reason_id? }
 *   TTN update    : PATCH /v1/merchant_public_api/orders/{id}          { delivery_tracking_number, status: 'delivering' }
 */

import { createServiceClient } from '@/lib/supabase/service'

const MAUDAU_JWT_TTL_MS = 23 * 60 * 60 * 1000 // 23 hours
const TOKEN_KEY = 'maudau_jwt'

// Layer 1: in-memory for warm instances
let memJwt: string | null = null
let memExpiry = 0

// Layer 2: fetch/store in Supabase
async function loadJwtFromDb(): Promise<string | null> {
  try {
    const supabase = createServiceClient()
    const { data } = await supabase
      .from('app_tokens')
      .select('value, expires_at')
      .eq('key', TOKEN_KEY)
      .single()
    if (!data) return null
    if (new Date(data.expires_at) <= new Date()) return null
    return data.value
  } catch {
    return null
  }
}

async function saveJwtToDb(jwt: string): Promise<void> {
  try {
    const supabase = createServiceClient()
    const expiresAt = new Date(Date.now() + MAUDAU_JWT_TTL_MS).toISOString()
    await supabase.from('app_tokens').upsert({
      key: TOKEN_KEY,
      value: jwt,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' })
  } catch {
    // Non-fatal — we'll just login again next time
  }
}

async function loginMaudau(): Promise<string> {
  const res = await fetch(
    `${process.env.MAUDAU_BASE}/v1/merchant_public_api/login`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: process.env.MAUDAU_LOGIN,
        password: process.env.MAUDAU_PASSWORD,
      }),
    },
  )

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`MauDau login failed: ${res.status} ${body.slice(0, 300)}`)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await res.json()
  const jwt = data.data?.jwt ?? data.jwt
  if (!jwt) throw new Error('MauDau login: no JWT in response')
  return jwt as string
}

export async function getMaudauJwt(): Promise<string> {
  // Layer 1: in-memory
  if (memJwt && Date.now() < memExpiry) return memJwt

  // Layer 2: Supabase
  const dbJwt = await loadJwtFromDb()
  if (dbJwt) {
    memJwt = dbJwt
    memExpiry = Date.now() + MAUDAU_JWT_TTL_MS
    return dbJwt
  }

  // Layer 3: fresh login
  const jwt = await loginMaudau()

  memJwt = jwt
  memExpiry = Date.now() + MAUDAU_JWT_TTL_MS
  await saveJwtToDb(jwt) // persist for other instances

  return jwt
}

/** Invalidate cached JWT (call when API returns 401) */
export function invalidateMaudauJwt(): void {
  memJwt = null
  memExpiry = 0
}

/**
 * Update MauDau order STATUS.
 * Endpoint: PATCH /v1/merchant_public_api/orders/{id}/status
 * Auto-retries once with a fresh token on 401.
 */
export async function patchMaudauStatus(
  numericId: string,
  status: string,
  cancellationReasonId?: number,
  jwt?: string,
): Promise<void> {
  const token = jwt ?? (await getMaudauJwt())
  const url = `${process.env.MAUDAU_BASE}/v1/merchant_public_api/orders/${numericId}/status`
  const body: Record<string, unknown> = { status }
  if (cancellationReasonId != null) body.cancellation_reason_id = cancellationReasonId

  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })

  if (res.status === 401) {
    // Token expired — invalidate and retry once
    invalidateMaudauJwt()
    const freshToken = await getMaudauJwt()
    const retry = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${freshToken}` },
      body: JSON.stringify(body),
    })
    if (!retry.ok) {
      const errBody = await retry.text().catch(() => '')
      throw new Error(`MauDau status update failed: ${retry.status} ${errBody.slice(0, 300)}`)
    }
    return
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw new Error(`MauDau status update failed: ${res.status} ${errBody.slice(0, 300)}`)
  }
}

/**
 * Update MauDau order TTN (tracking number).
 * Endpoint: PATCH /v1/merchant_public_api/orders/{id}  { delivery_tracking_number, status: 'delivering' }
 */
export async function patchMaudauTtn(
  numericId: string,
  ttn: string,
  jwt?: string,
): Promise<void> {
  const token = jwt ?? (await getMaudauJwt())
  const url = `${process.env.MAUDAU_BASE}/v1/merchant_public_api/orders/${numericId}`

  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ delivery_tracking_number: ttn, status: 'delivering' }),
  })

  if (res.status === 401) {
    invalidateMaudauJwt()
    const freshToken = await getMaudauJwt()
    const retry = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${freshToken}` },
      body: JSON.stringify({ delivery_tracking_number: ttn, status: 'delivering' }),
    })
    if (!retry.ok) {
      const errBody = await retry.text().catch(() => '')
      throw new Error(`MauDau TTN update failed: ${retry.status} ${errBody.slice(0, 300)}`)
    }
    return
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw new Error(`MauDau TTN update failed: ${res.status} ${errBody.slice(0, 300)}`)
  }
}

/**
 * MauDau API helpers — shared across all API routes.
 *
 * JWT caching: module-level singleton so warm Vercel function instances
 * reuse the same token instead of hitting /login on every request.
 * Token lifetime is conservatively set to 23h (MauDau issues 24h tokens).
 *
 * Endpoints (from spec / Code.gs):
 *   Status change : PATCH /v1/merchant_public_api/orders/{id}/status  { status }
 *   TTN update    : PATCH /v1/merchant_public_api/orders/{id}          { delivery_tracking_number, status: 'delivering' }
 *   Cancel        : PATCH /v1/merchant_public_api/orders/{id}/status  { status: 'canceled', cancellation_reason_id? }
 */

const MAUDAU_JWT_TTL_MS = 23 * 60 * 60 * 1000 // 23 hours

let cachedJwt: string | null = null
let cachedJwtExpiry = 0

export async function getMaudauJwt(): Promise<string> {
  if (cachedJwt && Date.now() < cachedJwtExpiry) {
    return cachedJwt
  }

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
    throw new Error(`MauDau login failed: ${res.status} ${body.slice(0, 200)}`)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await res.json()
  const jwt = data.data?.jwt ?? data.jwt
  if (!jwt) throw new Error('MauDau login: no JWT in response')

  cachedJwt = jwt
  cachedJwtExpiry = Date.now() + MAUDAU_JWT_TTL_MS
  return jwt
}

/**
 * Update MauDau order STATUS.
 * Endpoint: PATCH /v1/merchant_public_api/orders/{id}/status
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

  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw new Error(`MauDau status update failed: ${res.status} ${errBody.slice(0, 300)}`)
  }
}

/**
 * Update MauDau order TTN (tracking number).
 * Endpoint: PATCH /v1/merchant_public_api/orders/{id}  { delivery_tracking_number, status }
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

  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw new Error(`MauDau TTN update failed: ${res.status} ${errBody.slice(0, 300)}`)
  }
}

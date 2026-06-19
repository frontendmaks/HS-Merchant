/**
 * MauDau API helpers — shared across all API routes.
 *
 * JWT caching: module-level singleton so warm Vercel function instances
 * reuse the same token instead of hitting /login on every request.
 * Token lifetime is conservatively set to 23h (MauDau issues 24h tokens).
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

/** PATCH (with PUT fallback) a MauDau order. Throws on failure. */
export async function patchMaudauOrder(
  numericId: string,
  body: Record<string, unknown>,
  jwt: string,
): Promise<void> {
  const url = `${process.env.MAUDAU_BASE}/v1/merchant_public_api/orders/${numericId}`
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` }
  const payload = JSON.stringify(body)

  const patch = await fetch(url, { method: 'PATCH', headers, body: payload })
  if (!patch.ok) {
    const put = await fetch(url, { method: 'PUT', headers, body: payload })
    if (!put.ok) {
      const errBody = await put.text().catch(() => '')
      throw new Error(`MauDau update failed: ${put.status} ${errBody.slice(0, 200)}`)
    }
  }
}

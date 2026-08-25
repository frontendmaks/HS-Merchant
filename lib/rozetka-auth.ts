/**
 * Rozetka access tokens.
 *
 * Rozetka does not issue permanent keys: /sites/login returns a token that
 * lives 24 hours, and goes inactive if unused for 24 hours. A token pasted
 * into an environment variable therefore stops working within a day — which is
 * exactly what happened here, silently, to both order sync and product upload.
 *
 * Caching mirrors lib/maudau.ts: in-memory for a warm function, Supabase
 * app_tokens for everything else, so concurrent instances share one login.
 */

import { createServiceClient } from '@/lib/supabase/service'

const BASE = process.env.ROZETKA_BASE || 'https://api-seller.rozetka.com.ua'
/** Rozetka says 24h; refresh an hour early so a request never races the expiry */
const TTL_MS = 23 * 60 * 60 * 1000
const TOKEN_KEY = 'rozetka_token'

let memToken: string | null = null
let memExpiry = 0

async function loadFromDb(): Promise<string | null> {
  try {
    const { data } = await createServiceClient()
      .from('app_tokens')
      .select('value, expires_at')
      .eq('key', TOKEN_KEY)
      .single()
    if (!data || new Date(data.expires_at) <= new Date()) return null
    return data.value
  } catch {
    return null
  }
}

async function saveToDb(token: string): Promise<void> {
  try {
    await createServiceClient().from('app_tokens').upsert({
      key: TOKEN_KEY,
      value: token,
      expires_at: new Date(Date.now() + TTL_MS).toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' })
  } catch {
    // Non-fatal — the next call just logs in again
  }
}

/** Rozetka wants the password base64-encoded, the username as-is. */
async function login(): Promise<string> {
  const username = process.env.ROZETKA_LOGIN
  const password = process.env.ROZETKA_PASSWORD
  if (!username || !password) {
    throw new Error(
      'Не задані ROZETKA_LOGIN і ROZETKA_PASSWORD. Токен Rozetka живе 24 години, ' +
      'тож панель має логінитись сама, а не зберігати готовий токен.',
    )
  }

  // POST /sites, not /sites/login — the latter answers 5404 not_found
  const res = await fetch(`${BASE}/sites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password: Buffer.from(password, 'utf8').toString('base64'),
    }),
  })

  const body = await res.text()
  let data: { success?: boolean; content?: { access_token?: string }; errors?: unknown }
  try {
    data = JSON.parse(body)
  } catch {
    throw new Error(`Rozetka login: невалідна відповідь ${res.status}: ${body.slice(0, 200)}`)
  }

  const token = data.content?.access_token
  if (!data.success || !token) {
    throw new Error(`Rozetka login не вдався: ${JSON.stringify(data.errors ?? data).slice(0, 250)}`)
  }
  return token
}

export async function rozetkaToken(): Promise<string> {
  if (memToken && Date.now() < memExpiry) return memToken

  const stored = await loadFromDb()
  if (stored) {
    memToken = stored
    memExpiry = Date.now() + TTL_MS
    return stored
  }

  const token = await login()
  memToken = token
  memExpiry = Date.now() + TTL_MS
  await saveToDb(token)
  return token
}

/** Drop the cached token so the next call logs in again. Call on a 1020. */
export function invalidateRozetkaToken(): void {
  memToken = null
  memExpiry = 0
  createServiceClient().from('app_tokens').delete().eq('key', TOKEN_KEY).then(() => {})
}

/** True when Rozetka is telling us the token is no longer valid. */
export const isTokenError = (e: unknown): boolean =>
  /1020|incorrect_access_token|Невірний токен/i.test(String(e))

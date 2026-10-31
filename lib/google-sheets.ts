/**
 * Доступ до Google Таблиць із сервера.
 *
 * «Відкрито для редагування за посиланням» не дає права писати через API —
 * Google пускає на запис лише автентифікованого. Тому сервісний акаунт: у
 * нього власна пошта, якій дають доступ до таблиці так само, як людині.
 *
 * Підпис токена робимо самі — заради одного RS256 тягнути бібліотеку немає за
 * що, а менше залежностей означає менше несподіванок при оновленнях.
 */
import { isTest, heldBack } from '@/lib/env-mode'
import { createSign } from 'node:crypto'

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets'

interface Credentials { client_email: string; private_key: string }

function credentials(): Credentials | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!raw?.trim()) return null
  try {
    const parsed = JSON.parse(raw) as Credentials
    if (!parsed.client_email || !parsed.private_key) return null
    // У змінних оточення перенос рядка часто лишається як \n
    return { ...parsed, private_key: parsed.private_key.replace(/\\n/g, '\n') }
  } catch {
    return null
  }
}

export const sheetsConfigured = () => credentials() !== null

const b64 = (s: string | Buffer) =>
  Buffer.from(s).toString('base64url')

let cached: { token: string; expires: number } | null = null

/** Токен живе годину; просимо новий за хвилину до кінця. */
async function accessToken(): Promise<string | null> {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token

  const creds = credentials()
  if (!creds) return null

  const now = Math.floor(Date.now() / 1000)
  const header = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64(JSON.stringify({
    iss: creds.client_email,
    scope: SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }))

  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${claims}`)
  const jwt = `${header}.${claims}.${b64(signer.sign(creds.private_key))}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) return null
  const data = await res.json() as { access_token?: string; expires_in?: number }
  if (!data.access_token) return null

  cached = {
    token: data.access_token,
    expires: Date.now() + (data.expires_in ?? 3600) * 1000,
  }
  return cached.token
}

const api = (path: string) => `https://sheets.googleapis.com/v4/spreadsheets/${path}`

export async function readRange(
  spreadsheetId: string,
  range: string,
): Promise<string[][] | null> {
  const token = await accessToken()
  if (!token) return null

  const res = await fetch(
    api(`${spreadsheetId}/values/${encodeURIComponent(range)}`),
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
  )
  if (!res.ok) return null
  const data = await res.json() as { values?: string[][] }
  return data.values ?? []
}

export async function writeCell(
  spreadsheetId: string,
  range: string,
  value: string,
): Promise<boolean> {
  if (isTest) {
    heldBack('Google Таблиці', `${range} ← ${value}`)
    return true
  }

  const token = await accessToken()
  if (!token) return false

  const res = await fetch(
    api(`${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`),
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [[value]] }),
      signal: AbortSignal.timeout(15_000),
    },
  )
  return res.ok
}

/** Назви вкладок — щоб перевірити, чи є потрібна дата. */
export async function sheetTitles(spreadsheetId: string): Promise<string[] | null> {
  const token = await accessToken()
  if (!token) return null

  const res = await fetch(
    api(`${spreadsheetId}?fields=sheets.properties.title`),
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
  )
  if (!res.ok) return null
  const data = await res.json() as { sheets?: { properties?: { title?: string } }[] }
  return (data.sheets ?? []).map(s => s.properties?.title ?? '').filter(Boolean)
}

/**
 * Вхідні двері інтеграції.
 *
 * Усе, що стосується «хто це і чи можна йому», зібрано тут: ключ, права,
 * частота звернень, повтори. Маршрути не вирішують цього самі — інакше рано чи
 * пізно з'явиться маршрут, який забули захистити.
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

type Service = ReturnType<typeof createServiceClient>

export interface Client {
  id: string
  name: string
  scopes: string[]
  rate_limit_per_min: number
  webhook_url: string | null
}

export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex')

/**
 * Порівняння за сталий час.
 *
 * Звичайне порівняння рядків виходить раніше на першій розбіжності, і за
 * різницею в часі відповіді ключ можна підібрати посимвольно. Тут час не
 * залежить від того, скільки символів збіглося.
 */
function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex'), y = Buffer.from(b, 'hex')
  return x.length === y.length && timingSafeEqual(x, y)
}

/** IP клієнта за заголовками Vercel. */
export function clientIp(req: NextRequest): string {
  return (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim()
    || req.headers.get('x-real-ip')
    || 'unknown'
}

export interface Denied { response: NextResponse }
export interface Allowed { client: Client; service: Service; ip: string }

/**
 * @param scope право, потрібне саме цьому маршруту
 */
export async function authorize(
  req: NextRequest,
  scope: string,
): Promise<Allowed | Denied> {
  const ip = clientIp(req)
  const header = req.headers.get('authorization') ?? ''
  const key = header.replace(/^Bearer\s+/i, '').trim()

  const service = createServiceClient()

  /**
   * Відмова теж потрапляє в журнал.
   *
   * Інакше підбір ключа не обмежувався нічим: лічильник частоти рахує рядки
   * журналу, а невдалі спроби туди не лягали — тисяча спроб за хвилину
   * виглядала як нуль запитів.
   */
  const fail = async (status: number, error: string, headers?: Record<string, string>) => {
    await service.from('integration_requests').insert({
      client_id: null,
      method: req.method,
      path: new URL(req.url).pathname,
      status, ip,
      error: error.slice(0, 200),
    })
    return { response: NextResponse.json({ error }, { status, headers }) }
  }

  /**
   * Невдалі спроби з однієї адреси — окремий лічильник.
   *
   * Ліміт клієнта тут не допомагає: поки ключ не вгадано, клієнта немає, і
   * прив'язувати лічильник нема до чого. Рахуємо за адресою.
   */
  const since401 = new Date(Date.now() - 60_000).toISOString()
  const { count: denied } = await service
    .from('integration_requests')
    .select('id', { count: 'exact', head: true })
    .is('client_id', null)
    .eq('ip', ip)
    .gte('created_at', since401)

  if ((denied ?? 0) >= 20) {
    return {
      response: NextResponse.json(
        { error: 'Забагато невдалих спроб' },
        { status: 429, headers: { 'Retry-After': '60' } }),
    }
  }

  if (!key || key.length < 20) {
    return fail(401, 'Потрібен ключ: заголовок Authorization: Bearer <ключ>')
  }

  const { data: rows } = await service
    .from('integration_clients')
    .select('id, name, scopes, rate_limit_per_min, webhook_url, key_hash, is_active')
    .eq('key_hash', hashKey(key))
    .limit(1)

  const row = rows?.[0]
  if (!row || !sameHash(row.key_hash as string, hashKey(key))) {
    return fail(401, 'Невідомий ключ')
  }
  if (!row.is_active) return fail(403, 'Ключ вимкнено')

  const scopes = (row.scopes as string[]) ?? []
  if (!scopes.includes(scope)) {
    return fail(403, `Ключ не має права «${scope}»`)
  }

  // Частота: рахуємо власні звернення за останню хвилину.
  //
  // Проти справжньої атаки це не щит — її ріже Vercel раніше, ніж запит дійде
  // сюди. Це захист від зіпсованого циклу в чужому коді, який уміє покласти
  // базу не гірше за зловмисника.
  const since = new Date(Date.now() - 60_000).toISOString()
  const { count } = await service
    .from('integration_requests')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', row.id)
    .gte('created_at', since)

  const limit = row.rate_limit_per_min as number
  if (limit > 0 && (count ?? 0) >= limit) {
    return {
      response: NextResponse.json(
        { error: `Забагато запитів: ліміт ${limit} за хвилину` },
        { status: 429, headers: { 'Retry-After': '60' } },
      ),
    }
  }

  await service.from('integration_clients')
    .update({ last_seen_at: new Date().toISOString(), last_ip: ip })
    .eq('id', row.id)

  return {
    client: {
      id: row.id as string,
      name: row.name as string,
      scopes,
      rate_limit_per_min: limit,
      webhook_url: row.webhook_url as string | null,
    },
    service,
    ip,
  }
}

export const isDenied = (r: Allowed | Denied): r is Denied => 'response' in r

/** Запис у журнал звернень — він же лічильник для обмеження частоти. */
export async function logRequest(
  service: Service,
  clientId: string | null,
  req: NextRequest,
  status: number,
  startedAt: number,
  error?: string,
) {
  await service.from('integration_requests').insert({
    client_id: clientId,
    method: req.method,
    path: new URL(req.url).pathname,
    status,
    ip: clientIp(req),
    duration_ms: Date.now() - startedAt,
    error: error?.slice(0, 500) ?? null,
  })
}

/**
 * Повторний запит із тим самим ключем повертає ту саму відповідь.
 *
 * З'єднання рветься після того, як робота вже зроблена. Клієнт повторює — і
 * без цього комплектація застосувалась би двічі.
 */
export async function replayed(
  service: Service,
  clientId: string,
  key: string | null,
): Promise<NextResponse | null> {
  if (!key) return null
  const { data } = await service
    .from('integration_idempotency')
    .select('response').eq('key', `${clientId}:${key}`).maybeSingle()

  return data ? NextResponse.json(data.response, { headers: { 'X-Idempotent-Replay': 'true' } }) : null
}

export async function remember(
  service: Service,
  clientId: string,
  key: string | null,
  response: unknown,
) {
  if (!key) return
  await service.from('integration_idempotency')
    .upsert({ key: `${clientId}:${key}`, client_id: clientId, response }, { onConflict: 'key' })
}

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentRole, canAccess } from '@/lib/getRole'
import {
  CONNECTORS, saveIntegration, integrationConfig, type Connector,
} from '@/lib/integrations'
import * as viber from '@/lib/viber'
import * as telegram from '@/lib/telegram'
import { bitrix, bitrixConfigured } from '@/lib/bitrix'

type Service = ReturnType<typeof createServiceClient>

/** Чим кожен сервіс відповідає на «ти живий і чий ти» */
interface Probe {
  /** Коротко про акаунт — саме це читає людина на картці */
  who: string
  warning?: string
}

async function probeViber(token: string, base: string): Promise<Probe> {
  const info = await viber.accountInfo(token)
  if (info.status !== 0) throw new Error(info.status_message || 'Viber не відповів')

  const hook = await viber.setWebhook(token, `${base}/api/viber/webhook`).catch(() => null)
  return {
    who: `${info.name ?? 'акаунт'} · підписників ${info.subscribers_count ?? 0}`,
    warning: !hook || hook.status !== 0
      ? `події не надходитимуть: ${hook?.status_message ?? 'вебхук не прийнявся'}`
      : undefined,
  }
}

async function probeTelegram(token: string, base: string): Promise<Probe> {
  const info = await telegram.botInfo(token)
  if (!info.ok) throw new Error(info.description || 'Telegram не відповів')

  const hook = await telegram.setWebhook(token, `${base}/api/telegram/webhook`).catch(() => null)
  return {
    who: info.result?.username ? `@${info.result.username}` : 'бот',
    warning: !hook?.ok
      ? `події не надходитимуть: ${hook?.description ?? 'вебхук не прийнявся'}`
      : undefined,
  }
}

const PROBES: Record<string, (token: string, base: string) => Promise<Probe>> = {
  viber: probeViber,
  telegram: probeTelegram,
}

const UNHOOKS: Record<string, (token: string) => Promise<unknown>> = {
  viber: viber.dropWebhook,
  telegram: telegram.dropWebhook,
}

/**
 * Перевірка тих зв'язків, що живуть у змінних оточення.
 *
 * Змінити їх звідси не можна — і не треба, — але «змінна є» ще не означає
 * «працює». Питаємо сам сервіс, і на картці стоїть його відповідь.
 */
async function probeEnv(key: string): Promise<Probe> {
  if (key === 'bitrix') {
    if (!bitrixConfigured()) throw new Error('BITRIX_WEBHOOK_URL не задано')
    const me = await bitrix<{ NAME?: string; LAST_NAME?: string }>('profile', {})
    return { who: `від імені ${[me?.NAME, me?.LAST_NAME].filter(Boolean).join(' ') || 'вебхука'}` }
  }

  if (key === 'trello') {
    const k = process.env.TRELLO_KEY
    const t = process.env.TRELLO_TOKEN
    if (!k || !t) throw new Error('TRELLO_KEY або TRELLO_TOKEN не задано')
    const res = await fetch(
      `https://api.trello.com/1/members/me?fields=username&key=${k}&token=${t}`,
      { signal: AbortSignal.timeout(15_000) },
    )
    if (!res.ok) throw new Error(`Trello відповів ${res.status}`)
    const me = await res.json() as { username?: string }
    return { who: me.username ? `@${me.username}` : 'акаунт' }
  }

  if (key === 'sheets') {
    const { sheetsConfigured } = await import('@/lib/google-sheets')
    if (!sheetsConfigured()) throw new Error('Сервісний акаунт Google не задано')
    return { who: 'сервісний акаунт налаштовано' }
  }

  throw new Error('Перевірка для цього сервісу не написана')
}

async function tokenFor(
  service: Service,
  connector: Connector,
  given: Record<string, string> | undefined,
): Promise<string | null> {
  const field = connector.fields?.[0]?.name ?? 'token'
  const fresh = given?.[field]?.trim()
  if (fresh) return fresh

  const saved = await integrationConfig<Record<string, string>>(service, connector.key)
    ?? (await service.from('integrations').select('config').eq('key', connector.key).maybeSingle())
      .data?.config as Record<string, string> | undefined

  return saved?.[field] ?? null
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const role = await getCurrentRole()
  if (!canAccess('integrations', role)) {
    return NextResponse.json({ error: 'Немає доступу' }, { status: 403 })
  }

  const { key } = await params
  const connector = CONNECTORS.find(c => c.key === key)
  if (!connector) return NextResponse.json({ error: 'Невідомий сервіс' }, { status: 404 })

  const body = await request.json().catch(() => null) as {
    action?: 'connect' | 'disconnect' | 'forget' | 'check'
    config?: Record<string, string>
  } | null

  const action = body?.action ?? 'check'
  const service = createServiceClient()
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://hs-merchant.vercel.app'

  // Зі змінних оточення — лише перевірка: міняти їх можна тільки там,
  // де вони задані, і робити вигляд, що звідси теж, було б оманою
  if (connector.managed === 'env') {
    if (action !== 'check') {
      return NextResponse.json({
        error: 'Цей зв’язок задано у змінних оточення — змінюється там',
      }, { status: 400 })
    }
    try {
      const probe = await probeEnv(key)
      await saveIntegration(service, key, {
        status: probe.who, checked_at: new Date().toISOString(),
      })
      return NextResponse.json({ ok: true, who: probe.who })
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      await saveIntegration(service, key, {
        status: `не відповідає: ${detail}`, checked_at: new Date().toISOString(),
      })
      return NextResponse.json({ error: detail }, { status: 400 })
    }
  }

  if (action === 'disconnect' || action === 'forget') {
    /*
     * Вимкнути й забути — різні речі.
     *
     * Вимикають частіше «на час розібратись»: токен лишається, увімкнути
     * можна одним рухом. Забути — це коли міняють акаунт назовсім, і
     * старий токен не має лежати в базі «про всяк випадок».
     */
    const token = await tokenFor(service, connector, undefined)
    if (token && UNHOOKS[key]) await UNHOOKS[key](token).catch(() => null)

    await saveIntegration(service, key, {
      enabled: false,
      status: action === 'forget' ? 'акаунт відключено' : 'вимкнено',
      ...(action === 'forget' ? { config: {} } : {}),
    })
    return NextResponse.json({ ok: true })
  }

  const token = await tokenFor(service, connector, body?.config)
  if (!token) return NextResponse.json({ error: 'Вкажіть токен' }, { status: 400 })

  const probe = PROBES[key]
  if (!probe) {
    return NextResponse.json({ error: 'Цей сервіс ще не вміємо під’єднувати' }, { status: 400 })
  }

  try {
    /*
     * Вмикаємо до перевірки вебхука: він звіряє підпис події зі збереженим
     * токеном, а отже токен має вже лежати в базі, коли сервіс постукає.
     */
    await saveIntegration(service, key, {
      enabled: true, config: { token }, checked_at: new Date().toISOString(),
    })

    const result = await probe(token, base)
    await saveIntegration(service, key, {
      status: result.warning ? `${result.who} — ${result.warning}` : result.who,
      checked_at: new Date().toISOString(),
    })

    return NextResponse.json({ ok: true, who: result.who, warning: result.warning })
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    await saveIntegration(service, key, {
      enabled: false, status: detail, checked_at: new Date().toISOString(),
    })
    return NextResponse.json({ error: detail }, { status: 400 })
  }
}

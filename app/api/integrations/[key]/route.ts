import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentRole } from '@/lib/getRole'
import { CONNECTORS, saveIntegration, integrationConfig } from '@/lib/integrations'
import { accountInfo, setWebhook, dropWebhook } from '@/lib/viber'

/** Під'єднувати сервіси може лише той, хто відповідає за систему */
const ALLOWED = ['super_admin', 'admin']

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const role = await getCurrentRole()
  if (!ALLOWED.includes(role ?? '')) {
    return NextResponse.json({ error: 'Немає доступу' }, { status: 403 })
  }

  const { key } = await params
  const connector = CONNECTORS.find(c => c.key === key)
  if (!connector || connector.managed !== 'panel') {
    return NextResponse.json({ error: 'Такий сервіс звідси не під’єднується' }, { status: 400 })
  }

  const body = await request.json().catch(() => null) as {
    action?: 'connect' | 'disconnect' | 'check'
    config?: Record<string, string>
  } | null

  const service = createServiceClient()
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://hs-merchant.vercel.app'

  if (body?.action === 'disconnect') {
    /*
     * Вимикаємо, але токен лишаємо.
     *
     * Вимикають частіше «на час розібратись», ніж назавжди, і змушувати
     * шукати токен знову заради цього — зайва робота. Разом із тим знімаємо
     * вебхук: вимкнений сервіс не має приймати подій.
     */
    if (key === 'viber') {
      const config = await integrationConfig<{ token?: string }>(service, key)
      if (config?.token) await dropWebhook(config.token).catch(() => null)
    }
    await saveIntegration(service, key, { enabled: false, status: 'вимкнено' })
    return NextResponse.json({ ok: true })
  }

  if (key === 'viber') {
    const token = body?.config?.token?.trim()
      || (await integrationConfig<{ token?: string }>(service, key))?.token

    if (!token) return NextResponse.json({ error: 'Вкажіть токен' }, { status: 400 })

    const info = await accountInfo(token).catch(() => null)
    if (!info || info.status !== 0) {
      await saveIntegration(service, key, {
        enabled: false,
        status: info?.status_message ?? 'Viber не відповів',
        checked_at: new Date().toISOString(),
      })
      return NextResponse.json(
        { error: info?.status_message ?? 'Viber не відповів' }, { status: 400 },
      )
    }

    // Вмикаємо до вебхука: він перевіряє підпис через збережений токен
    await saveIntegration(service, key, {
      enabled: true,
      config: { token },
      status: `${info.name ?? 'акаунт'} · підписників ${info.subscribers_count ?? 0}`,
      checked_at: new Date().toISOString(),
    })

    const hook = await setWebhook(token, `${base}/api/viber/webhook`).catch(() => null)
    if (!hook || hook.status !== 0) {
      await saveIntegration(service, key, {
        status: `під’єднано, але події не надходитимуть: ${hook?.status_message ?? 'вебхук не прийнявся'}`,
      })
      return NextResponse.json({
        ok: true,
        warning: hook?.status_message ?? 'Вебхук не прийнявся',
      })
    }

    return NextResponse.json({ ok: true, status: info.name })
  }

  return NextResponse.json({ error: 'Цей сервіс ще не вміємо під’єднувати' }, { status: 400 })
}

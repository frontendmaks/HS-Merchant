import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor } from '@/lib/order-events'
import { getCurrentRole } from '@/lib/getRole'
import { getSettings, setSetting, DEFAULTS, type SettingKey } from '@/lib/settings'

/** Налаштування читає будь-хто з доступом, міняє лише той, хто відповідає. */
const CAN_EDIT = ['super_admin', 'admin']

export async function GET() {
  if (!await currentActor()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json(await getSettings(createServiceClient()))
}

export async function POST(req: NextRequest) {
  const actor = await currentActor()
  const role = await getCurrentRole()
  if (!actor || !CAN_EDIT.includes(role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => null) as { key?: string; value?: unknown } | null
  if (!body?.key || !(body.key in DEFAULTS)) {
    return NextResponse.json({ error: 'Невідоме налаштування' }, { status: 400 })
  }

  // Буфер поза межами здорового глузду ламає прийом замовлень тихо: періоди
  // просто перестають відкриватись, і ніхто не розуміє чому
  let value = body.value
  if (body.key === 'delivery_buffer_minutes') {
    const n = Math.round(Number(value))
    if (!Number.isFinite(n) || n < 0 || n > 240) {
      return NextResponse.json({ error: 'Буфер — від 0 до 240 хвилин' }, { status: 400 })
    }
    value = n
  }

  await setSetting(createServiceClient(), body.key as SettingKey, value, actor.id)
  return NextResponse.json({ ok: true, key: body.key, value })
}

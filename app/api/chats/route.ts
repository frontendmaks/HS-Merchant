import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { currentActor } from '@/lib/order-events'
import { getCurrentRole } from '@/lib/getRole'
import { visibleChats } from '@/lib/bitrix-chat'
import { bitrixConfigured } from '@/lib/bitrix'

/**
 * Чати складів.
 *
 * GET — що бот бачить і що вже прив'язано.
 * POST — прив'язати чат до складу (або прибрати прив'язку).
 *
 * Прив'язка — це налаштування, яке вирішує, куди поїде бланк замовлення, тож
 * міняти її можуть лише ті, хто відповідає за налаштування.
 */
const ALLOWED = ['super_admin', 'admin']

export async function GET() {
  const role = await getCurrentRole()
  if (!await currentActor() || !ALLOWED.includes(role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const service = createServiceClient()
  const [{ data: zones }, { data: linked }] = await Promise.all([
    service.from('delivery_zones').select('warehouse'),
    service.from('warehouse_chats').select('warehouse, dialog_id, title'),
  ])

  const warehouses = [...new Set((zones ?? []).map(z => z.warehouse as string))].sort()

  let chats: { id: string; title: string }[] = []
  let error: string | null = null
  if (bitrixConfigured()) {
    try { chats = await visibleChats() } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  } else {
    error = 'Бітрікс не налаштовано'
  }

  return NextResponse.json({ warehouses, linked: linked ?? [], chats, error })
}

export async function POST(req: NextRequest) {
  const role = await getCurrentRole()
  if (!await currentActor() || !ALLOWED.includes(role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => null) as
    { warehouse?: string; dialog_id?: string | null; title?: string } | null

  if (!body?.warehouse) {
    return NextResponse.json({ error: 'Вкажіть склад' }, { status: 400 })
  }

  const service = createServiceClient()

  if (!body.dialog_id) {
    await service.from('warehouse_chats').delete().eq('warehouse', body.warehouse)
    return NextResponse.json({ ok: true, removed: true })
  }

  await service.from('warehouse_chats').upsert({
    warehouse: body.warehouse,
    dialog_id: body.dialog_id,
    title: body.title ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'warehouse' })

  return NextResponse.json({ ok: true })
}

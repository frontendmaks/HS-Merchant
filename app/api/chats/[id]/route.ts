import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentRole, canAccess } from '@/lib/getRole'
import { currentActor } from '@/lib/order-events'
import { reply, markRead } from '@/lib/chats'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const role = await getCurrentRole()
  if (!canAccess('chats', role)) {
    return NextResponse.json({ error: 'Немає доступу' }, { status: 403 })
  }

  const { id } = await params
  const body = await request.json().catch(() => null) as { text?: string } | null
  const text = (body?.text ?? '').trim()
  if (!text) return NextResponse.json({ error: 'Порожня відповідь' }, { status: 400 })

  const service = createServiceClient()
  const actor = await currentActor()

  const result = await reply(service, id, text, {
    id: actor?.id ?? null, name: actor?.name ?? null,
  })

  // Відповіли — отже, прочитали
  await markRead(service, id)

  return result.ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: result.error }, { status: 502 })
}

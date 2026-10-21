import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { rememberChat } from '@/lib/telegram'

/**
 * Події від Telegram.
 *
 * Як і у Viber, це єдине джерело, з якого ми дізнаємось, кому взагалі
 * можна писати: бот не пише першим.
 */
export async function POST(request: NextRequest) {
  const update = await request.json().catch(() => null) as {
    message?: {
      text?: string
      chat?: { id?: number | string }
      from?: { first_name?: string; last_name?: string }
      contact?: { phone_number?: string }
    }
    my_chat_member?: {
      chat?: { id?: number | string }
      new_chat_member?: { status?: string }
    }
  } | null

  if (!update) return NextResponse.json({ ok: true })
  const service = createServiceClient()

  const blocked = update.my_chat_member?.new_chat_member?.status
  if (blocked === 'kicked' || blocked === 'left') {
    const id = update.my_chat_member?.chat?.id
    if (id != null) {
      await service.from('telegram_chats')
        .update({ blocked_at: new Date().toISOString() })
        .eq('chat_id', String(id))
    }
    return NextResponse.json({ ok: true })
  }

  const chatId = update.message?.chat?.id
  if (chatId != null) {
    await rememberChat(service, {
      chatId: String(chatId),
      name: [update.message?.from?.first_name, update.message?.from?.last_name]
        .filter(Boolean).join(' ') || null,
      phone: update.message?.contact?.phone_number ?? null,
      // «/start 0671234567» — так ми дізнаємось, чий це чат, ще до того
      // як людина щось напише
      payload: update.message?.text?.match(/^\/start\s+(\S+)/)?.[1] ?? null,
    })
  }

  return NextResponse.json({ ok: true })
}

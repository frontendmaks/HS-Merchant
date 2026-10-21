import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { rememberChat, sendWelcome } from '@/lib/telegram'
import { integrationConfig } from '@/lib/integrations'

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
    const contact = update.message?.contact?.phone_number ?? null
    // «/start 0671234567» — так ми дізнаємось, чий це чат, ще до того
    // як людина щось напише
    const payload = update.message?.text?.match(/^\/start(?:\s+(\S+))?/)

    await rememberChat(service, {
      chatId: String(chatId),
      name: [update.message?.from?.first_name, update.message?.from?.last_name]
        .filter(Boolean).join(' ') || null,
      phone: contact,
      payload: payload?.[1] ?? null,
    })

    /*
     * Відповідаємо на «Почати» й на надісланий контакт.
     *
     * Мовчання тут гірше за будь-який текст: людина натиснула кнопку й не
     * побачила нічого, а отже вирішила, що бот не працює.
     */
    if (payload || contact) {
      const { data: row } = await service
        .from('telegram_chats').select('phone').eq('chat_id', String(chatId)).maybeSingle()

      const config = await integrationConfig<{ token?: string }>(service, 'telegram')
      if (config?.token) {
        await sendWelcome(config.token, String(chatId), !!row?.phone)
      }
    }
  }

  return NextResponse.json({ ok: true })
}

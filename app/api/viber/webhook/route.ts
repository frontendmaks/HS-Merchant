import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { rememberSubscriber } from '@/lib/viber'
import { integrationConfig } from '@/lib/integrations'
import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Події від Viber.
 *
 * Сюди приходить усе, що робить людина з нашим публічним акаунтом:
 * підписалась, написала, поділилась контактом. Це єдине джерело, з якого
 * ми дізнаємось, кому взагалі можна писати.
 *
 * Підпис перевіряємо обов'язково: адреса відкрита, і без перевірки будь-хто
 * міг би записати нам чужий ідентифікатор замість клієнтового.
 */
export async function POST(request: NextRequest) {
  const service = createServiceClient()
  const raw = await request.text()

  const config = await integrationConfig<{ token?: string }>(service, 'viber')
  if (!config?.token) return NextResponse.json({ status: 0 })

  const signature = request.headers.get('x-viber-content-signature') ?? ''
  const expected = createHmac('sha256', config.token).update(raw).digest('hex')

  const a = Buffer.from(signature, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'bad signature' }, { status: 403 })
  }

  const event = JSON.parse(raw) as {
    event: string
    user?: { id: string; name?: string; avatar?: string }
    sender?: { id: string; name?: string; avatar?: string }
    user_id?: string
    message?: { type?: string; contact?: { phone_number?: string } }
  }

  const person = event.user ?? event.sender
  const id = person?.id ?? event.user_id

  switch (event.event) {
    case 'subscribed':
    case 'conversation_started':
    case 'message':
      if (id) {
        await rememberSubscriber(service, {
          id,
          name: person?.name,
          avatar: person?.avatar,
          // Номер є лише тоді, коли людина натиснула «поділитись контактом»
          phone: event.message?.contact?.phone_number,
        })
      }
      break

    case 'unsubscribed':
      if (id) {
        await service.from('viber_subscribers')
          .update({ unsubscribed_at: new Date().toISOString() })
          .eq('viber_id', id)
      }
      break
  }

  // Viber чекає саме такої відповіді, інакше вважає адресу зламаною
  return NextResponse.json({ status: 0, status_message: 'ok' })
}

import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 503 })
  }

  try {
    const { text } = await request.json()
    if (!text?.trim()) return NextResponse.json({ translation: '' })

    const client = new Anthropic()
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `Переклади цей текст з української на російську мову. Поверни лише переклад без пояснень, вступних слів та лапок:\n\n${text}`,
      }],
    })

    const translation = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
    return NextResponse.json({ translation })
  } catch (err: any) {
    console.error('translate error:', err?.message)
    return NextResponse.json({ error: err?.message ?? 'Translation failed' }, { status: 500 })
  }
}

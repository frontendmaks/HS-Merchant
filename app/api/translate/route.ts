import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'

const client = new Anthropic()

export async function POST(request: Request) {
  const { text } = await request.json()
  if (!text?.trim()) return NextResponse.json({ translation: '' })

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
}

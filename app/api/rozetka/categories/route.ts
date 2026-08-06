/**
 * GET /api/rozetka/categories?title=xxx
 * Returns Rozetka category list for product creation setup.
 */
import { NextRequest, NextResponse } from 'next/server'
import { rozetkaGetCategories } from '@/lib/rozetka-api'

export async function GET(req: NextRequest) {
  try {
    const title = req.nextUrl.searchParams.get('title') ?? undefined
    const categories = await rozetkaGetCategories({ title })
    return NextResponse.json({ success: true, categories })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

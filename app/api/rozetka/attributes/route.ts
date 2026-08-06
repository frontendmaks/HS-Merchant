/**
 * GET /api/rozetka/attributes?category_id=xxx
 * Returns Rozetka attributes for a category (for mapping setup).
 *
 * GET /api/rozetka/attributes?category_id=xxx&attribute_id=yyy
 * Returns allowed values for a specific attribute.
 */
import { NextRequest, NextResponse } from 'next/server'
import { rozetkaGetAttributes, rozetkaGetAttributeValues } from '@/lib/rozetka-api'

export async function GET(req: NextRequest) {
  try {
    const categoryId = Number(req.nextUrl.searchParams.get('category_id') ?? 0)
    if (!categoryId) return NextResponse.json({ error: 'category_id required' }, { status: 400 })

    const attributeId = Number(req.nextUrl.searchParams.get('attribute_id') ?? 0)

    if (attributeId) {
      const values = await rozetkaGetAttributeValues(categoryId, attributeId)
      return NextResponse.json({ success: true, values })
    }

    const attributes = await rozetkaGetAttributes(categoryId)
    return NextResponse.json({ success: true, attributes })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

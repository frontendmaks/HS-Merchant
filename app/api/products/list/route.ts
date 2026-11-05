import { NextRequest, NextResponse } from 'next/server'
import { getCurrentRole, canAccess } from '@/lib/getRole'
import { productPage } from '@/lib/product-page'
export async function GET(req: NextRequest) {
  const role = await getCurrentRole()
  if (!canAccess('products', role)) return NextResponse.json({ error: 'Немає доступу' }, { status: 403 })
  let filters: Record<string, unknown>
  try { filters = JSON.parse(req.nextUrl.searchParams.get('filters') ?? '{}') }
  catch { return NextResponse.json({ error: 'Некоректні фільтри' }, { status: 400 }) }
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) return NextResponse.json({ error: 'Некоректні фільтри' }, { status: 400 })
  return NextResponse.json(await productPage(filters), { headers: { 'Cache-Control': 'private, no-store' } })
}

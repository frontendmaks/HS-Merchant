import { NextRequest, NextResponse } from 'next/server'
import { authorize, isDenied, logRequest } from '@/lib/integration-auth'

/**
 * GET /api/integration/v1/products
 *
 * Каталог із боку номенклатури — щоб зовнішня система могла звірити свій
 * довідник із нашим раз і більше про це не думати.
 *
 * Віддається те, за чим упізнають товар: uid і код 1С, артикул, штрихкод,
 * назва в нашому каталозі, одиниця та фасування. Ціни тут наші, сайтові — не
 * плутати з цінами маркетплейсу в замовленнях, які можуть відрізнятись.
 *
 *   ?since=2026-10-01T00:00:00Z   лише змінені після
 *   ?limit=200                    до 500
 */
export async function GET(req: NextRequest) {
  const started = Date.now()
  const auth = await authorize(req, 'products:read')
  if (isDenied(auth)) return auth.response

  const { client, service } = auth
  const params = req.nextUrl.searchParams
  const limit = Math.min(Math.max(Number(params.get('limit') ?? 200), 1), 500)

  let query = service.from('products')
    .select(`external_id, uid_1c, code_1c, sku, barcode, name, unit,
             price, stock, category_name, status, attributes, updated_at`)
    .eq('status', 'active')
    .order('updated_at', { ascending: true })
    .limit(limit)

  const since = params.get('since')
  if (since) {
    const at = new Date(since)
    if (Number.isNaN(at.getTime())) {
      await logRequest(service, client.id, req, 400, started, 'bad since')
      return NextResponse.json({ error: 'since має бути датою ISO 8601' }, { status: 400 })
    }
    query = query.gt('updated_at', at.toISOString())
  }

  const { data, error } = await query
  if (error) {
    await logRequest(service, client.id, req, 500, started, error.message)
    return NextResponse.json({ error: 'Не вдалося прочитати каталог' }, { status: 500 })
  }

  const products = (data ?? []).map(p => ({
    uid_1c: p.uid_1c,
    code_1c: p.code_1c,
    sku: p.sku,
    barcode: p.barcode,
    name: p.name,
    unit: p.unit,
    /** Фасування з картки: «Мін» — крок продажу вагового товару */
    pack: (p.attributes as Record<string, string> | null)?.['Мін'] ?? null,
    price: Number(p.price ?? 0),
    stock: p.stock == null ? null : Number(p.stock),
    category: p.category_name,
    merchant_id: p.external_id,
    updated_at: p.updated_at,
  }))

  await logRequest(service, client.id, req, 200, started)
  return NextResponse.json({
    products,
    next_since: products.length === limit ? products[products.length - 1].updated_at : null,
    count: products.length,
  })
}

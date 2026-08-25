/**
 * POST /api/rozetka/upload-product-ids   (multipart: file=<PriceCreator export>)
 *
 * Teaches the feed which Rozetka card each of our products already is, so that
 * turning the feed on updates those cards instead of creating duplicates and
 * dropping the originals to "немає в наявності".
 *
 * The export has one sheet per Rozetka category and no usable key column, so
 * cards are matched by name — see lib/rozetka-match.ts. Anything uncertain is
 * reported rather than guessed.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { matchRozetkaCards, type MatchInput } from '@/lib/rozetka-match'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()
    const file = form.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'Файл не надіслано' }, { status: 400 })

    const wb = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: 'buffer' })

    const cards: MatchInput[] = []
    for (const sheetName of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName])
      for (const r of rows) {
        const id = String(r['ID'] ?? '').trim().replace(/\.0$/, '')
        const name = String(r['Назва (укр)'] ?? r['Назва'] ?? '').trim()
        if (id && name) cards.push({ rozetka_id: id, name })
      }
    }

    if (!cards.length) {
      return NextResponse.json(
        { error: 'Не знайдено жодного товару. Потрібен експорт із Pricecreator з колонками ID та Назва.' },
        { status: 400 },
      )
    }

    const supabase = createServiceClient()
    const { data: products, error: pErr } = await supabase
      .from('products').select('external_id, name').limit(20000)
    if (pErr) throw pErr

    const result = matchRozetkaCards(
      cards,
      (products ?? []).map(p => ({ external_id: String(p.external_id), name: p.name as string })),
    )

    if (result.matched.length) {
      const now = new Date().toISOString()
      const { error } = await supabase.from('rozetka_product_ids').upsert(
        result.matched.map(m => ({ ...m, updated_at: now })),
        { onConflict: 'external_id' },
      )
      if (error) throw error
    }

    return NextResponse.json({
      success: true,
      total: cards.length,
      matched: result.matched.length,
      ambiguous: result.ambiguous,
      missing: result.missing,
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message ?? 'Помилка' }, { status: 500 })
  }
}

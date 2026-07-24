import { createServiceClient } from '@/lib/supabase/service'
import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'

export const maxDuration = 30

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })

    const buf = Buffer.from(await file.arrayBuffer())
    const wb = XLSX.read(buf, { type: 'buffer' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows: any[] = XLSX.utils.sheet_to_json(ws, { header: 1 })

    if (rows.length < 2) return NextResponse.json({ error: 'Empty file' }, { status: 400 })

    const headers: string[] = rows[0].map((h: any) => String(h ?? '').trim())
    const idIdx = headers.indexOf('id')
    const skuIdx = headers.indexOf('sku_main')

    if (idIdx === -1 || skuIdx === -1)
      return NextResponse.json({ error: 'Файл має містити колонки "id" та "sku_main"' }, { status: 400 })

    const entries: { sku: string; maudau_id: string }[] = []
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]
      const maudauId = String(row[idIdx] ?? '').trim()
      const sku = String(row[skuIdx] ?? '').trim()
      if (maudauId && sku) entries.push({ sku, maudau_id: maudauId })
    }

    if (entries.length === 0) return NextResponse.json({ error: 'Не знайдено жодного запису' }, { status: 400 })

    const supabase = createServiceClient()
    const { error } = await supabase
      .from('maudau_product_ids')
      .upsert(entries, { onConflict: 'sku' })

    if (error) throw error

    return NextResponse.json({ success: true, count: entries.length })
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Помилка' }, { status: 500 })
  }
}

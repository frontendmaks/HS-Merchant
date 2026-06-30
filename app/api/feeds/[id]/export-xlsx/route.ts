import { createServiceClient } from '@/lib/supabase/service'
import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createServiceClient()

  const { data: feedProducts } = await supabase
    .from('feed_products')
    .select('*, product:products(id, name, description, category_name, brand, price, price_old, sku)')
    .eq('feed_id', id)
    .eq('is_active', true)

  if (!feedProducts?.length) {
    return NextResponse.json({ error: 'No active products' }, { status: 404 })
  }

  const rows = feedProducts.map((fp: any) => {
    const p = fp.product ?? {}
    const cp = (fp.custom_params ?? {}) as Record<string, string>

    const name = fp.custom_name ?? p.name ?? ''
    const sku = p.sku ?? p.id ?? ''
    const price = fp.custom_price ?? p.price ?? ''

    // Use SKU as id only if it's purely numeric/latin (no Cyrillic)
    // Cyrillic SKUs (Я0150, К0116) need to go as barcode only; id stays empty for MauDau matching
    const isCyrillicSku = sku && /[а-яА-ЯіІїЇєЄёЁ]/.test(sku)
    const maudauId = isCyrillicSku ? '' : sku

    return {
      id: maudauId,
      brand_name_uk: cp['Торгова марка'] ?? p.brand ?? 'Галицька Свіжина',
      'packaging_info.temperature_mode': cp['Тип обробки'] ?? '',
      country_title_uk: cp['Країна виробник'] ?? 'Україна',
      title_uk: name,
      title_ru: fp.name_ru ?? '',
      description_uk: cp['Опис'] ?? p.description ?? '',
      description_ru: fp.description_ru ?? '',
      'composition.content_uk': cp['Склад'] ?? '',
      'composition.content_ru': '',
      source_document_name: '',
      type: cp['Тип'] ?? '',
      'packaging_info.height': '',
      'packaging_info.weight': cp['Вага упаковки'] ?? cp['Вага'] ?? '',
      'packaging_info.width': '',
      'packaging_info.length': '',
      'supply_info.repeat_period_days': '',
      barcode: sku,
      additional_barcodes: '',
      price,
      old_price: p.price_old ?? '',
    }
  })

  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  // filename like template: DD-MM-YYYY_HH-MM-SS_fields_import_products.xlsx
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const filename = `${pad(now.getDate())}-${pad(now.getMonth()+1)}-${now.getFullYear()}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}_fields_import_products.xlsx`

  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}

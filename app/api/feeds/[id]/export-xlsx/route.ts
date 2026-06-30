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
    .select('*, product:products(id, name, description, category_name, brand, price, price_old, stock, images, attributes, sku)')
    .eq('feed_id', id)
    .eq('active', true)

  if (!feedProducts) {
    return NextResponse.json({ error: 'No products' }, { status: 404 })
  }

  const rows = feedProducts.map((fp: any) => {
    const p = fp.product
    const params = (fp.custom_params ?? {}) as Record<string, string>

    const name = fp.custom_name ?? p.name ?? ''
    const nameRu = fp.name_ru ?? ''
    const descUk = params['Опис'] ?? p.description ?? ''
    const descRu = fp.description_ru ?? ''
    const skladUk = params['Склад'] ?? ''
    const brand = params['Торгова марка'] ?? p.brand ?? 'Галицька Свіжина'
    const country = params['Країна виробник'] ?? 'Україна'
    const tempMode = params['Тип обробки'] ?? ''
    const type = params['Тип'] ?? ''
    const weightVal = params['Вага упаковки'] ?? params['Вага'] ?? ''
    const price = fp.custom_price ?? p.price ?? ''
    const oldPrice = p.price_old ?? ''
    const sku = p.sku ?? p.id ?? ''

    return {
      id: sku,
      brand_name_uk: brand,
      'packaging_info.temperature_mode': tempMode,
      country_title_uk: country,
      title_uk: name,
      title_ru: nameRu,
      description_uk: descUk,
      description_ru: descRu,
      'composition.content_uk': skladUk,
      'composition.content_ru': '',
      source_document_name: '',
      type,
      'packaging_info.height': '',
      'packaging_info.weight': weightVal,
      'packaging_info.width': '',
      'packaging_info.length': '',
      'supply_info.repeat_period_days': '',
      barcode: sku,
      additional_barcodes: '',
      price,
      old_price: oldPrice,
    }
  })

  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="maudau-products.xlsx"`,
    },
  })
}

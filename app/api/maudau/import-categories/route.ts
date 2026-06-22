/**
 * POST /api/maudau/import-categories
 *
 * Accepts a multipart/form-data upload with the MauDau characteristics Excel file.
 * Parses all rows, extracts category names + slugs/IDs, stores in maudau_categories table.
 *
 * The MauDau Excel file typically has columns like:
 *   ID | Назва категорії | Slug | Батьківська категорія
 * We try to detect these columns flexibly.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import * as XLSX from 'xlsx'

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ success: false, error: 'No file uploaded' }, { status: 400 })

    const buffer = Buffer.from(await file.arrayBuffer())
    const workbook = XLSX.read(buffer, { type: 'buffer' })

    // Try every sheet, find one with category data
    const categories: { slug: string; title: string; parent_slug: string | null }[] = []

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName]
      const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
      if (rows.length < 2) continue

      // Find header row — look for row containing "категор" or "id" keywords
      let headerIdx = -1
      let idCol = -1, titleCol = -1, slugCol = -1, parentCol = -1

      for (let i = 0; i < Math.min(5, rows.length); i++) {
        const row = rows[i].map((c: any) => String(c).toLowerCase().trim())
        const hasTitle = row.some(c => c.includes('назв') || c.includes('categor') || c.includes('title'))
        if (hasTitle) {
          headerIdx = i
          row.forEach((c, j) => {
            if ((c.includes('id') || c === '#') && idCol < 0) idCol = j
            if ((c.includes('назв') || c.includes('title') || c.includes('categor')) && titleCol < 0) titleCol = j
            if (c.includes('slug') && slugCol < 0) slugCol = j
            if ((c.includes('батьк') || c.includes('parent')) && parentCol < 0) parentCol = j
          })
          break
        }
      }

      if (headerIdx < 0 || titleCol < 0) continue

      for (let i = headerIdx + 1; i < rows.length; i++) {
        const row = rows[i]
        const title = String(row[titleCol] ?? '').trim()
        if (!title) continue

        // Derive slug: use slug column, or ID column, or slugify title
        let slug = ''
        if (slugCol >= 0 && row[slugCol]) {
          slug = String(row[slugCol]).trim()
        } else if (idCol >= 0 && row[idCol]) {
          slug = String(row[idCol]).trim()
        } else {
          slug = slugify(title)
        }

        if (!slug) continue

        const parent = parentCol >= 0 ? String(row[parentCol] ?? '').trim() || null : null

        categories.push({ slug, title, parent_slug: parent })
      }

      if (categories.length > 0) break // found useful sheet
    }

    if (categories.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'Не вдалося розпізнати структуру файлу. Переконайтеся що у файлі є колонки з назвою та ID/slug категорій.',
      }, { status: 422 })
    }

    // Upsert into DB
    const supabase = createServiceClient()
    const { error } = await supabase
      .from('maudau_categories')
      .upsert(categories, { onConflict: 'slug' })

    if (error) throw error

    return NextResponse.json({ success: true, count: categories.length })
  } catch (err: any) {
    console.error('import-categories error:', err)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[іїєа-яёА-ЯЁ]/g, c => UA_TRANSLIT[c] ?? c)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}

const UA_TRANSLIT: Record<string, string> = {
  'а':'a','б':'b','в':'v','г':'h','ґ':'g','д':'d','е':'e','є':'ye','ж':'zh','з':'z',
  'и':'y','і':'i','ї':'yi','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o',
  'п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch',
  'ш':'sh','щ':'shch','ь':'','ю':'yu','я':'ya',
}

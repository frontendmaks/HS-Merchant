/**
 * POST /api/maudau/upload-attr-template
 *
 * Accepts a MauDau characteristics import template xlsx (downloaded from MauDau's "Шаблон імпорту")
 * along with a portal_id. Parses the s.{slug} column headers to extract the correct MauDau
 * characteristic slugs, then stores them as the `slug` field in maudau_categories.attributes.
 *
 * Request: multipart/form-data
 *   portal_id: string
 *   file: xlsx file
 *
 * The template xlsx has headers like: id | s.vaha | s.typ | s.pryznachennya | ...
 * We extract the slug from each s.xxx header and match it to our stored attribute names
 * using position-based matching (attrs in template order = attrs in DB order).
 */

import { createServiceClient } from '@/lib/supabase/service'
import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'

export const maxDuration = 30

const UA_TRANSLIT: Record<string, string> = {
  'а':'a','б':'b','в':'v','г':'h','ґ':'g','д':'d','е':'e','є':'ye','ж':'zh','з':'z',
  'и':'y','і':'i','ї':'yi','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o',
  'п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch',
  'ш':'sh','щ':'shch','ь':'','ю':'yu','я':'ya',
}
function attrToSlug(name: string): string {
  return name.toLowerCase().split('').map(c => UA_TRANSLIT[c] ?? c).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const portalId = String(formData.get('portal_id') ?? '').trim()
    const file = formData.get('file') as File | null

    if (!portalId || !file) {
      return NextResponse.json({ error: 'Потрібні portal_id та file' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // Load current attributes for this category
    const { data: cat } = await supabase
      .from('maudau_categories')
      .select('slug, title, attributes')
      .eq('portal_id', portalId)
      .single()

    if (!cat) {
      return NextResponse.json({ error: `Категорія portal_id=${portalId} не знайдена` }, { status: 404 })
    }

    const attrs: { name: string; type: string; values: string[]; slug?: string }[] = cat.attributes ?? []
    if (attrs.length === 0) {
      return NextResponse.json({ error: 'У цієї категорії немає збережених атрибутів' }, { status: 400 })
    }

    // Parse the xlsx template
    const buf = Buffer.from(await file.arrayBuffer())
    const wb = XLSX.read(buf, { type: 'buffer' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Порожній файл' }, { status: 400 })
    }

    const headers: string[] = rows[0].map((h: any) => String(h ?? '').trim())
    // Extract s.xxx slugs (exclude 'id' column)
    const maudauSlugs = headers
      .filter(h => h.startsWith('s.'))
      .map(h => h.slice(2)) // strip "s." prefix

    if (maudauSlugs.length === 0) {
      return NextResponse.json({ error: 'Не знайдено колонок s.xxx у шаблоні. Переконайтесь що це правильний шаблон MauDau.' }, { status: 400 })
    }

    // Try two matching strategies:
    // 1. By attrToSlug name match (most reliable)
    // 2. By position (fallback)

    const updatedAttrs = attrs.map(attr => ({ ...attr }))

    // Strategy 1: name-based matching
    const usedSlugs = new Set<string>()
    for (const attr of updatedAttrs) {
      const ourSlug = attrToSlug(attr.name)
      const match = maudauSlugs.find(s => s === ourSlug || s.startsWith(ourSlug + '-') || ourSlug.startsWith(s + '-'))
      if (match && !usedSlugs.has(match)) {
        attr.slug = match
        usedSlugs.add(match)
      }
    }

    // Strategy 2: position-based for unmatched attrs (only if counts match)
    const unmatchedAttrs = updatedAttrs.filter(a => !a.slug)
    const unmatchedSlugs = maudauSlugs.filter(s => !usedSlugs.has(s))

    if (unmatchedAttrs.length > 0 && unmatchedAttrs.length === unmatchedSlugs.length) {
      for (let i = 0; i < unmatchedAttrs.length; i++) {
        unmatchedAttrs[i].slug = unmatchedSlugs[i]
      }
    }

    // Save updated attributes
    const { error: updateErr } = await supabase
      .from('maudau_categories')
      .update({ attributes: updatedAttrs })
      .eq('portal_id', portalId)

    if (updateErr) throw updateErr

    const matched = updatedAttrs.filter(a => a.slug).length
    const unmatched = updatedAttrs.filter(a => !a.slug).map(a => a.name)

    return NextResponse.json({
      success: true,
      category: cat.title,
      matched,
      total: updatedAttrs.length,
      unmatched,
      mapping: updatedAttrs.map(a => ({ name: a.name, slug: a.slug ?? null })),
    })
  } catch (err: any) {
    console.error('upload-attr-template error:', err)
    return NextResponse.json({ error: err.message ?? 'Помилка' }, { status: 500 })
  }
}

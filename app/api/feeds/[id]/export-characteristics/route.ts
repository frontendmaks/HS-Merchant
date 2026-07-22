import { createServiceClient } from '@/lib/supabase/service'
import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'

// ── Inference helpers (mirrors FeedEditor.tsx logic) ──────────────────────────

function inferType(name: string, allowedValues: string[] = []): string | null {
  const n = name.toLowerCase()
  const allowed = new Set(allowedValues)
  const pick = (v: string) => (!allowed.size || allowed.has(v)) ? v : null

  if (/сирокопчен/.test(n)) return pick('Сирокопчена')
  if (/сиров.ял/.test(n)) return pick("Сиров'ялена")
  if (/варено-копчен/.test(n)) return pick('Варено-копчена')
  if (/напівкопчен/.test(n)) return pick('Напівкопчена')
  if (/кабанос/.test(n)) return pick('Сирокопчена')
  if (/\bкопчен/.test(n)) return pick('Копчена')
  if (/\bварен/.test(n)) return pick('Варена')
  if (/смажен/.test(n)) return pick('Смажена')
  if (/\bстейк/.test(n)) return pick('Стейк')
  if (/биточк/.test(n)) return pick('Биточки')
  if (/фрикадел|мітбол/.test(n)) return pick('Фрикадельки') || pick('Мітболи')
  if (/тефтел/.test(n)) return pick('Тефтелі')
  if (/котлет/.test(n)) return pick('Котлети')
  if (/шашлик/.test(n)) return pick('Шашлик')
  if (/кебаб|люля/.test(n)) return pick('Кебаби')
  if (/\bпаштет/.test(n)) return pick('Паштети')
  if (/сосис|сарделк/.test(n)) return pick('Сосиски для гриля')
  if (/\bребр/.test(n)) return pick('Ребра')
  if (/фарш(?![а-яіїєьА-ЯІЇЄ])/.test(n)) return pick('Фарш')
  if (/нагетс/.test(n)) return pick('Нагетси')
  if (/крильц|крило/.test(n)) return pick('Крильця')
  if (/голінк|гомілк/.test(n)) return pick('Гомілки')
  if (/\bкаре\b/.test(n)) return pick('Каре')
  if (/щічк/.test(n)) return pick('Щічки')
  if (/біфстроганов/.test(n)) return pick('Біфстроганов')
  if (/нарізк/.test(n)) return pick("М'ясна нарізка")
  if (/пшенич/.test(n)) return pick('Пшеничний')
  if (/жит(н|ьо)/.test(n)) return pick('Житній')
  if (/гречан/.test(n)) return pick('Гречаний')
  if (/кукурудз/.test(n)) return pick('Кукурудзяний')
  if (/висівков/.test(n)) return pick('Висівковий')
  return null
}

function inferSort(name: string, allowedValues: string[]): string | null {
  if (!allowedValues.length) return null
  const n = name.toLowerCase()
  const allowed = new Set(allowedValues)
  if (/салям/.test(n) && allowed.has('Салямі')) return 'Салямі'
  if (/пепероні/.test(n) && allowed.has('Пепероні')) return 'Пепероні'
  if (/фует/.test(n) && allowed.has('Фует')) return 'Фует'
  if (/сальчичон/.test(n) && allowed.has('Сальчичон')) return 'Сальчичон'
  if (/чорізо/.test(n) && allowed.has('Чорізо')) return 'Чорізо'
  return null
}

function inferDobavky(name: string, allowedValues: string[]): string | null {
  if (!allowedValues.length) return null
  const n = name.toLowerCase()
  const allowed = new Set(allowedValues)
  const found: string[] = []
  if (/горіх/.test(n) && allowed.has('Горіхи')) found.push('Горіхи')
  if (/гриб/.test(n) && allowed.has('Гриби')) found.push('Гриби')
  if (/зелен/.test(n) && allowed.has('Зелень')) found.push('Зелень')
  if (/оливк/.test(n) && allowed.has('Оливки')) found.push('Оливки')
  if (/паприк/.test(n) && allowed.has('Паприка')) found.push('Паприка')
  if (/\bтрав/.test(n) && allowed.has('Трави')) found.push('Трави')
  if (/сир(?!окопч|ов.ял)/.test(n) && allowed.has('Сир')) found.push('Сир')
  if (/перц/.test(n) && allowed.has('Перець')) found.push('Перець')
  if (/інжир/.test(n) && allowed.has('Інжир')) found.push('Інжир')
  return found.length ? found.join(', ') : null
}

function inferBase(name: string, categories: string[]): string | null {
  const text = (name + ' ' + categories.join(' ')).toLowerCase()
  if (/ягнят|баранин/.test(text)) return 'Баранина'
  if (/кролик/.test(text)) return 'Кролик'
  if (/індич/.test(text)) return 'Індичка'
  if (/качк/.test(text)) return 'Качка'
  if (/курч|кур'яч|курк|курятин/.test(text)) return 'Курка'
  if (/(ялович|телят).*свин|свин.*(ялович|телят)/.test(text)) return 'Свинина та яловичина'
  if (/ялович|телятин|теляч/.test(text)) return 'Яловичина'
  if (/свинин|свин/.test(text)) return 'Свинина'
  return null
}

function inferCookingMethods(type: string | null): string | null {
  const grillTypes = new Set(['Стейк', 'Шашлик', 'Кебаби', 'Сосиски для гриля', 'Котлети'])
  const panTypes = new Set(['Стейк', 'Котлети', 'Тефтелі', 'Фрикадельки', 'Нагетси'])
  const ovenTypes = new Set(['Ребра', 'Котлети', 'Тефтелі', 'Гомілки', 'Нагетси', 'Каре'])
  const potTypes = new Set(['Ребра', 'Гомілки', 'Фарш'])
  if (!type) return null
  const methods: string[] = []
  if (grillTypes.has(type)) methods.push('На мангалі або грилі')
  if (panTypes.has(type)) methods.push('На сковорідці')
  if (ovenTypes.has(type)) methods.push('У духовці')
  if (potTypes.has(type)) methods.push('У каструлі')
  return methods.length ? methods.join(', ') : null
}

const TYP_OBR_FIX: Record<string, string> = {
  'Охолоджений': 'Охолоджені', 'Охолоджена': 'Охолоджені',
  'Заморожений': 'Заморожені', 'Заморожена': 'Заморожені', 'Морожений': 'Заморожені',
}
const VALID_TYP_OBR = new Set(['Охолоджені', 'Заморожені', 'Варено-морожені'])
function fixTypObr(v: string): string {
  return TYP_OBR_FIX[v] ?? (VALID_TYP_OBR.has(v) ? v : 'Охолоджені')
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = createServiceClient()

  // 1. Feed + settings
  const { data: feed } = await supabase
    .from('feeds')
    .select('id, settings')
    .eq('id', id)
    .single()

  if (!feed) return NextResponse.json({ error: 'Feed not found' }, { status: 404 })

  const categoryPortalIds: Record<string, string> = feed.settings?.category_portal_ids ?? {}

  // 2. Active feed products
  const { data: feedProducts } = await supabase
    .from('feed_products')
    .select(`
      custom_params,
      product:products (
        external_id, name, brand, category_name, categories, attributes
      )
    `)
    .eq('feed_id', id)
    .eq('is_active', true)

  if (!feedProducts?.length) {
    return NextResponse.json({ error: 'No active products' }, { status: 404 })
  }

  // 3. MauDau categories (slug + portal_id + attributes)
  const { data: maudauCats } = await supabase
    .from('maudau_categories')
    .select('slug, title, portal_id, attributes')
    .not('portal_id', 'is', null)

  const slugToPortalId: Record<string, string> = {}
  const portalIdToAttrs: Record<string, { name: string; values: string[] }[]> = {}
  const portalIdToTitle: Record<string, string> = {}

  for (const cat of maudauCats ?? []) {
    if (cat.slug && cat.portal_id) slugToPortalId[cat.slug] = cat.portal_id
    if (cat.portal_id && cat.attributes) {
      portalIdToAttrs[cat.portal_id] = cat.attributes
      portalIdToTitle[cat.portal_id] = cat.title
    }
  }

  function resolvePortalId(wcCategory: string): string {
    const raw = categoryPortalIds[wcCategory] ?? ''
    if (!raw) return ''
    if (/^\d+$/.test(raw)) return raw
    return slugToPortalId[raw] ?? ''
  }

  // 4. Build per-category product rows
  const categorySheets = new Map<string, { title: string; attrs: { name: string; values: string[] }[]; rows: Record<string, string>[] }>()

  for (const fp of feedProducts) {
    const p = fp.product as any
    if (!p) continue

    const cp: Record<string, string> = fp.custom_params ?? {}
    const cats: string[] = p.categories ?? []
    const name: string = p.name ?? ''
    const productId: string = p.external_id ?? ''

    const portalId = resolvePortalId(p.category_name ?? '')
    if (!portalId) continue

    const catAttrs = portalIdToAttrs[portalId] ?? []
    const catTitle = portalIdToTitle[portalId] ?? p.category_name ?? ''
    const hasAttr = (n: string) => catAttrs.some(a => a.name === n)
    const attrValues = (n: string): string[] => catAttrs.find(a => a.name === n)?.values ?? []

    // Build merged params (custom_params + inferred)
    const params: Record<string, string> = { ...cp }

    // Тип
    if (hasAttr('Тип')) {
      const mType = inferType(name, attrValues('Тип'))
      if (mType) params['Тип'] = mType
    }

    // Сорт
    if (hasAttr('Сорт') && !params['Сорт']) {
      const mSort = inferSort(name, attrValues('Сорт'))
      if (mSort) params['Сорт'] = mSort
    }

    // Добавки
    if (hasAttr('Добавки') && !params['Добавки']) {
      const mDob = inferDobavky(name, attrValues('Добавки'))
      if (mDob) params['Добавки'] = mDob
    }

    // Основа
    if (hasAttr('Основа') && !params['Основа']) {
      const mBase = inferBase(name, cats)
      if (mBase) params['Основа'] = mBase
    }

    // Спосіб приготування
    if (hasAttr('Спосіб приготування') && !params['Спосіб приготування']) {
      const mCook = inferCookingMethods(params['Тип'] ?? null)
      if (mCook) params['Спосіб приготування'] = mCook
    }

    // Тип обробки — normalize
    if (hasAttr('Тип обробки')) {
      params['Тип обробки'] = fixTypObr(params['Тип обробки'] ?? 'Охолоджений')
    }

    // Вага — from product attributes if missing
    if (hasAttr('Вага') && !params['Вага'] && !params['Вага упаковки']) {
      const pAttrs = p.attributes ?? {}
      const unit = pAttrs['Одиниця'] ?? 'шт'
      const minVal = parseFloat(pAttrs['Мін'] ?? '0') || null
      if (minVal && ['кг', 'г', 'мл', 'л'].includes(unit)) {
        params['Вага'] = unit === 'кг' && minVal < 1
          ? `${Math.round(minVal * 1000)} г`
          : `${minVal} ${unit}`
      }
    }

    // Гарантія
    if (!params['Гарантія']) {
      params['Гарантія'] = 'Відповідно до законодавства України'
    }

    // Build row: id + category attributes
    const row: Record<string, string> = { id: productId }
    for (const attr of catAttrs) {
      const v = params[attr.name] ?? params['Вага упаковки'] ?? ''
      // Only include known characteristic columns (skip meta fields)
      if (['Країна виробник', 'Торгова марка', 'Вага упаковки', 'Назва', 'Опис', 'Склад'].includes(attr.name)) continue
      row[attr.name] = v || ''
    }

    if (!categorySheets.has(catTitle)) {
      categorySheets.set(catTitle, { title: catTitle, attrs: catAttrs.filter(a =>
        !['Країна виробник', 'Торгова марка', 'Вага упаковки', 'Назва', 'Опис', 'Склад'].includes(a.name)
      ), rows: [] })
    }
    categorySheets.get(catTitle)!.rows.push(row)
  }

  if (categorySheets.size === 0) {
    return NextResponse.json({ error: 'No products with mapped categories' }, { status: 404 })
  }

  // 5. Build xlsx workbook — one sheet per category
  const wb = XLSX.utils.book_new()

  for (const [, sheet] of categorySheets) {
    const headers = ['id', ...sheet.attrs.map(a => a.name)]
    const wsData = [headers, ...sheet.rows.map(row => headers.map(h => row[h] ?? ''))]
    const ws = XLSX.utils.aoa_to_sheet(wsData)
    // Trim sheet name to 31 chars (Excel limit)
    const sheetName = sheet.title.slice(0, 31)
    XLSX.utils.book_append_sheet(wb, ws, sheetName)
  }

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const filename = `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}_characteristics.xlsx`

  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}

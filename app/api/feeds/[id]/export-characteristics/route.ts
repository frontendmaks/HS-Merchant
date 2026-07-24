import { getMaudauJwt } from '@/lib/maudau'
import { createServiceClient } from '@/lib/supabase/service'
import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'

// ── Regex inference helpers ───────────────────────────────────────────────────

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

// ── MauDau column slug ────────────────────────────────────────────────────────

const UA_TRANSLIT: Record<string, string> = {
  'а':'a','б':'b','в':'v','г':'h','ґ':'g','д':'d','е':'e','є':'ye','ж':'zh','з':'z',
  'и':'y','і':'i','ї':'yi','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o',
  'п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch',
  'ш':'sh','щ':'shch','ь':'','ю':'yu','я':'ya',
}
function attrToSlug(name: string): string {
  return name
    .toLowerCase()
    .split('').map(c => UA_TRANSLIT[c] ?? c)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
function attrColName(name: string): string {
  return `s.${attrToSlug(name)}`
}

// ── Weight helpers ────────────────────────────────────────────────────────────

function parseGrams(s: string): number | null {
  const m = s.match(/([\d.,]+)\s*(кг|г|мл|л)/i)
  if (!m) return null
  const n = parseFloat(m[1].replace(',', '.'))
  const u = m[2].toLowerCase()
  if (u === 'кг' || u === 'л') return n * 1000
  return n
}

function closestWeight(rawWeight: string, allowedValues: string[]): string {
  if (!allowedValues.length) return rawWeight
  const isRangeBucket = allowedValues.some(v => /до |понад |- /i.test(v))
  if (isRangeBucket) {
    const grams = parseGrams(rawWeight)
    if (grams == null) return ''
    for (const v of allowedValues) {
      if (/^до\s/i.test(v)) {
        const max = parseGrams(v.replace(/^до\s/i, ''))
        if (max != null && grams <= max) return v
      } else if (/^понад\s/i.test(v)) {
        const min = parseGrams(v.replace(/^понад\s/i, ''))
        if (min != null && grams > min) return v
      } else {
        const parts = v.split(/\s*-\s*/)
        if (parts.length === 2) {
          const lo = parseGrams(parts[0]), hi = parseGrams(parts[1])
          if (lo != null && hi != null && grams >= lo && grams <= hi) return v
        }
      }
    }
    return ''
  }
  const grams = parseGrams(rawWeight)
  if (grams == null) return ''
  let best = '', bestDiff = Infinity
  for (const v of allowedValues) {
    const vg = parseGrams(v)
    if (vg == null) continue
    const diff = Math.abs(vg - grams)
    if (diff < bestDiff) { bestDiff = diff; best = v }
  }
  return bestDiff < grams * 0.3 ? best : ''
}

// ── Route ─────────────────────────────────────────────────────────────────────

export const maxDuration = 30

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

  // 2. Active feed products (include description)
  const { data: feedProducts } = await supabase
    .from('feed_products')
    .select(`
      custom_params,
      product:products (
        id, sku, external_id, name, description, brand, category_name, categories, attributes
      )
    `)
    .eq('feed_id', id)
    .eq('is_active', true)

  if (!feedProducts?.length) {
    return NextResponse.json({ error: 'No active products' }, { status: 404 })
  }

  // 3. MauDau categories
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

  // 4. First pass: regex inference — group by category
  type ProductEntry = {
    id: string
    name: string
    description: string
    params: Record<string, string>
    catAttrs: { name: string; values: string[] }[]
    catTitle: string
  }
  const categoryGroups = new Map<string, { portalId: string; catTitle: string; catAttrs: { name: string; values: string[] }[]; products: ProductEntry[] }>()

  for (const fp of feedProducts) {
    const p = fp.product as any
    if (!p) continue

    const cp: Record<string, string> = fp.custom_params ?? {}
    const cats: string[] = p.categories ?? []
    const name: string = p.name ?? ''
    const description: string = p.description ?? ''
    // MauDau requires their own internal product ID (= our external_id from WooCommerce sync)
    const productId: string = String(p.external_id || p.id || '')

    const portalId = resolvePortalId(p.category_name ?? '')
    if (!portalId) continue

    const catAttrs = portalIdToAttrs[portalId] ?? []
    const catTitle = portalIdToTitle[portalId] ?? p.category_name ?? ''
    const hasAttr = (n: string) => catAttrs.some(a => a.name === n)
    const attrValues = (n: string): string[] => catAttrs.find(a => a.name === n)?.values ?? []

    const params: Record<string, string> = { ...cp }
    // Гарантія must not be carried over from DB (wrong auto-fill value); leave empty
    delete params['Гарантія']

    // Regex inference
    if (hasAttr('Тип')) {
      const allowed = attrValues('Тип')
      const mType = inferType(name, allowed)
      if (mType) {
        params['Тип'] = mType
      } else if (params['Тип'] && allowed.length && !allowed.includes(params['Тип'])) {
        delete params['Тип']
      }
    }
    if (hasAttr('Сорт') && !params['Сорт']) {
      const mSort = inferSort(name, attrValues('Сорт'))
      if (mSort) params['Сорт'] = mSort
    }
    if (hasAttr('Добавки') && !params['Добавки']) {
      const mDob = inferDobavky(name, attrValues('Добавки'))
      if (mDob) params['Добавки'] = mDob
    }
    if (hasAttr('Основа') && !params['Основа']) {
      const mBase = inferBase(name, cats)
      if (mBase) params['Основа'] = mBase
    }
    if (hasAttr('Спосіб приготування') && !params['Спосіб приготування']) {
      const mCook = inferCookingMethods(params['Тип'] ?? null)
      if (mCook) params['Спосіб приготування'] = mCook
    }
    if (hasAttr('Тип обробки')) {
      params['Тип обробки'] = fixTypObr(params['Тип обробки'] ?? 'Охолоджений')
    }
    if (hasAttr('Вага')) {
      const allowedWeights = attrValues('Вага')
      const existingVaha = params['Вага'] ?? params['Вага упаковки'] ?? ''
      const pAttrs = p.attributes ?? {}
      const unit = pAttrs['Одиниця'] ?? 'шт'
      let rawWeight = existingVaha || pAttrs['Вага'] || ''
      if (!rawWeight) {
        const minVal = parseFloat(pAttrs['Мін'] ?? '0') || null
        if (minVal && ['кг', 'г', 'мл', 'л'].includes(unit)) {
          rawWeight = unit === 'кг' && minVal < 1
            ? `${Math.round(minVal * 1000)} г`
            : `${minVal} ${unit}`
        }
      }
      if (rawWeight) {
        const matched = closestWeight(rawWeight.trim(), allowedWeights)
        if (matched) params['Вага'] = matched
        else delete params['Вага'] // clear non-standard value
      } else {
        delete params['Вага']
      }
    }
    // Гарантія — do not auto-fill; leave empty so user sets it manually

    if (!categoryGroups.has(catTitle)) {
      categoryGroups.set(catTitle, { portalId, catTitle, catAttrs, products: [] })
    }
    categoryGroups.get(catTitle)!.products.push({ id: productId, name, description, params, catAttrs, catTitle })
  }

  if (categoryGroups.size === 0) {
    return NextResponse.json({ error: 'No products with mapped categories' }, { status: 404 })
  }

  // 5. Fetch MauDau product IDs — map vendor_code → maudau_id
  const vendorToMaudauId: Record<string, string> = {}
  try {
    const jwt = await getMaudauJwt()
    const BASE = process.env.MAUDAU_BASE!
    // Fetch up to 500 products from MauDau to get their internal IDs
    const r = await fetch(`${BASE}/v1/merchant_public_api/products?page=1&per_page=500`, {
      headers: { Authorization: `Bearer ${jwt}` },
    })
    if (r.ok) {
      const body = await r.json()
      const items: any[] = Array.isArray(body) ? body : (body.products ?? body.data?.products ?? body.items ?? [])
      for (const item of items) {
        const vc = item.vendor_code ?? item.article ?? item.vendorCode ?? ''
        const mid = String(item.id ?? item.product_id ?? '')
        if (vc && mid) vendorToMaudauId[vc] = mid
      }
    }
  } catch {
    // Non-fatal — fall back to vendor_code column if MauDau API unavailable
  }

  // 6. Build xlsx workbook with cell styling
  const wb = XLSX.utils.book_new()
  const YELLOW = { fgColor: { rgb: 'FFFF00' }, patternType: 'solid' }

  for (const [, group] of categoryGroups) {
    const { catTitle, catAttrs, products } = group
    const sheetAttrs = catAttrs.filter(a => !['Країна виробник', 'Торгова марка', 'Вага упаковки', 'Назва', 'Опис', 'Склад'].includes(a.name))
    const colKeys = sheetAttrs.map(a => a.name)

    // Build raw data rows (before filtering empty columns)
    const rawRows: (string | null)[][] = products.map(product => {
      // Resolve MauDau product ID: prefer lookup by vendor_code, fall back to vendor_code itself
      const maudauId = vendorToMaudauId[product.id] ?? ''
      return [
        maudauId || product.id, // id column = MauDau internal ID when available
        ...colKeys.map(k => {
          if (k === 'Вага') return product.params['Вага'] ?? product.params['Вага упаковки'] ?? null
          return product.params[k] ?? null
        }),
      ]
    })

    // Remove columns where ALL product rows are empty (skip id column at index 0)
    const keepColIndices: number[] = [0] // always keep id
    for (let C = 1; C <= colKeys.length; C++) {
      const hasValue = rawRows.some(row => row[C] !== null && row[C] !== '')
      if (hasValue) keepColIndices.push(C)
    }

    const filteredColKeys = keepColIndices.slice(1).map(i => colKeys[i - 1])
    const headers = ['id', ...filteredColKeys.map(attrColName)]
    const wsData: (string | null)[][] = [
      headers,
      ...rawRows.map(row => keepColIndices.map(i => row[i])),
    ]

    const ws = XLSX.utils.aoa_to_sheet(wsData)

    // Yellow highlight for empty non-id cells
    for (let R = 1; R < wsData.length; R++) {
      for (let C = 1; C < headers.length; C++) {
        if (filteredColKeys[C - 1] === 'Гарантія') continue
        const cellAddr = XLSX.utils.encode_cell({ r: R, c: C })
        if (!wsData[R][C]) {
          ws[cellAddr] = { v: '', t: 's', s: { fill: YELLOW } }
        }
      }
    }

    // Extend worksheet range to include empty styled cells
    const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
    range.e.r = Math.max(range.e.r, wsData.length - 1)
    range.e.c = Math.max(range.e.c, headers.length - 1)
    ws['!ref'] = XLSX.utils.encode_range(range)

    XLSX.utils.book_append_sheet(wb, ws, catTitle.slice(0, 31))
  }

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true })

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

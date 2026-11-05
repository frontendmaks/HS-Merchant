import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { createClient } from '@supabase/supabase-js'
process.loadEnvFile('.env.local')
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
if (!url?.includes('ygykdfzytcbfqdfqqhsy')) throw new Error('Unexpected project')
const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (url, opts) => fetch(url, { ...opts, signal: AbortSignal.timeout(15000) }) } })
const js = ts.transpileModule(readFileSync('lib/work-hours.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
const { onlineMinutes } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))
async function all(make) {
  const rows = []
  for (let i = 0; ; i += 1000) {
    const { data, error } = await make().range(i, i + 999)
    if (error) throw error
    rows.push(...data)
    if (data.length < 1000) return rows
  }
}
const from = '2026-10-01', to = '2026-11-05'
const [ticks, shifts, presence] = await Promise.all([
  all(() => db.from('presence_ticks').select('user_id,minute').gte('minute', from + 'T00:00:00Z').lte('minute', to + 'T23:59:59Z').order('user_id').order('minute')),
  all(() => db.from('work_shifts').select('operator_id,work_date').gte('work_date', from).lte('work_date', to).order('work_date')),
  db.rpc('merchant_presence_minutes', { p_from: from, p_to: to }),
])
if (presence.error) throw presence.error
const users = new Set(ticks.map(r => r.user_id))
let mismatches = 0
for (const id of users) {
  const dates = new Set(shifts.filter(r => r.operator_id === id).map(r => r.work_date))
  const original = onlineMinutes(ticks.filter(r => r.user_id === id).map(r => r.minute), dates)
  const aggregate = presence.data.find(r => r.user_id === id)?.online_minutes ?? 0
  if (original !== aggregate) mismatches++
}
if (mismatches) throw new Error('Presence aggregate differs from the original calculation')
const results = await Promise.all([{}, { page: 2 }, { status: 'active' }, { inStock: true }].map(async f => {
  const { data, error } = await db.rpc('merchant_product_page', { p_filters: f })
  if (error) throw error
  return data
}))
if (results[0].products.length !== 50 || results[1].products.length !== 50) throw new Error('Pagination size')
const ids = new Set([...results[0].products, ...results[1].products].map(r => r.id))
if (ids.size !== 100) throw new Error('Pagination duplicates')
for (const [index, query] of [[2, db.from('products').select('id', { count: 'exact', head: true }).eq('status', 'active')], [3, db.from('products').select('id', { count: 'exact', head: true }).gt('stock', 0)]]) {
  const { count, error } = await query
  if (error || count !== results[index].count) throw new Error('Filtered total mismatch')
}
console.log(JSON.stringify({ presence: { inputTicks: ticks.length, outputUsers: presence.data.length, mismatches }, catalogue: { total: results[0].count, pageSize: 50, uniqueAcrossTwoPages: ids.size, bytesFirstPage: Buffer.byteLength(JSON.stringify(results[0])) } }))

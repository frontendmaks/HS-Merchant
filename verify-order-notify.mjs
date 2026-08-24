// Proves that a sync announces only genuinely NEW orders.
// Deletes one existing order so the next sync re-discovers it, then checks
// exactly one notification per recipient was created for it.
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] })
)
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

let failed = false
const fail = m => { console.error('  FAIL —', m); failed = true }
const ok = m => console.log('  ok —', m)

const { count: recipientCount } = await db.from('profiles')
  .select('*', { count: 'exact', head: true }).eq('is_active', true).neq('role', 'viewer')
console.log(`recipients (active, non-viewer): ${recipientCount}\n`)

// Pick a recent MauDau order that the sync window will definitely re-fetch
const { data: candidates } = await db.from('orders')
  .select('external_id, customer_name, total, order_date')
  .eq('platform', 'maudau')
  .order('order_date', { ascending: false })
  .limit(1)

if (!candidates?.length) { console.error('no maudau orders to test with'); process.exit(1) }
const victim = candidates[0]
console.log(`test order: ${victim.external_id} (${victim.order_date})`)

const { data: backup } = await db.from('orders')
  .select('*').eq('platform', 'maudau').eq('external_id', victim.external_id).single()

const before = new Date().toISOString()

// Remove it so the sync sees it as new
await db.from('orders').delete().eq('platform', 'maudau').eq('external_id', victim.external_id)
ok('removed the order locally to simulate a fresh arrival')

// Run the real production sync
const res = await fetch('https://hs-merchant.vercel.app/api/cron/sync-orders?mode=quick', {
  headers: { 'x-cron-secret': env.CRON_SECRET },
})
const body = await res.json()
console.log(`  sync: HTTP ${res.status} maudau=${body.maudau_synced} error=${body.error ?? 'none'}`)

// The order must be back
const { data: restored } = await db.from('orders')
  .select('external_id').eq('platform', 'maudau').eq('external_id', victim.external_id).maybeSingle()
if (restored) ok('order re-synced from the marketplace')
else fail('order did not come back — restoring from backup')

// Exactly one notification per recipient, and only for this order
const { data: notifs } = await db.from('notifications')
  .select('user_id, type, title, body, link, created_at')
  .eq('type', 'order_new')
  .gt('created_at', before)

console.log(`\n  order_new notifications created: ${notifs?.length ?? 0}`)
if (notifs?.length) {
  console.log(`    title: ${notifs[0].title}`)
  console.log(`    body : ${notifs[0].body}`)
  console.log(`    link : ${notifs[0].link}`)
}

if (notifs?.length === recipientCount) ok(`one notification per recipient (${recipientCount})`)
else fail(`expected ${recipientCount} notifications, got ${notifs?.length ?? 0}`)

if (notifs?.every(n => n.body?.includes(victim.external_id))) ok('notification names the right order')
else fail('notification body does not reference the test order')

if (notifs?.every(n => n.title?.includes('MauDau'))) ok('notification names the marketplace')
else fail('marketplace missing from the title')

if (notifs?.every(n => n.link === '/orders')) ok('links to /orders')
else fail('wrong link target')

// The other ~295 untouched orders must NOT have been announced
const otherAnnounced = (notifs ?? []).filter(n => !n.body?.includes(victim.external_id))
if (otherAnnounced.length === 0) ok('no notifications for orders that already existed')
else fail(`${otherAnnounced.length} spurious notifications for known orders`)

// Cleanup: drop the test notifications, restore anything the sync could not
await db.from('notifications').delete().eq('type', 'order_new').gt('created_at', before)
if (!restored && backup) await db.from('orders').insert(backup)
ok('cleaned up test notifications')

console.log(failed ? '\nSOME CHECKS FAILED' : '\nALL CHECKS PASSED')
process.exit(failed ? 1 : 0)

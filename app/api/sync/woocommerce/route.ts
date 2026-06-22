import { createServiceClient } from '@/lib/supabase/service'
import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { syncWoocommerce } from '@/lib/sync-woocommerce'

async function getTriggeredBy(): Promise<string | null> {
  try {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
    )
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    const service = createServiceClient()
    const { data } = await service.from('profiles').select('full_name,email').eq('id', user.id).single()
    return data?.full_name || data?.email || user.email || null
  } catch { return null }
}

export async function POST() {
  const triggeredBy = await getTriggeredBy()

  // Захист від дублювання — якщо синкали менше 2 хв тому, пропускаємо
  const supabase = createServiceClient()
  const { data: recent } = await supabase
    .from('sync_logs')
    .select('created_at')
    .eq('status', 'success')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (recent) {
    const secAgo = (Date.now() - new Date(recent.created_at).getTime()) / 1000
    if (secAgo < 120) {
      return NextResponse.json({
        success: false,
        skipped: true,
        reason: `Синк вже виконувався ${Math.round(secAgo)}с тому. Зачекайте 2 хвилини.`,
      }, { status: 429 })
    }
  }

  try {
    const result = await syncWoocommerce('manual', triggeredBy)
    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

export async function GET() {
  const supabase = createServiceClient()
  const { count } = await supabase.from('products').select('*', { count: 'exact', head: true })
  return NextResponse.json({ products_in_db: count, warehouse: process.env.WC_WAREHOUSE ?? 'Гуртівня онлайн' })
}

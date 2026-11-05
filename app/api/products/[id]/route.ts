import { NextResponse } from 'next/server'
import { getCurrentRole, canAccess } from '@/lib/getRole'
import { createServiceClient } from '@/lib/supabase/service'
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const role = await getCurrentRole()
  if (!canAccess('products', role)) return NextResponse.json({ error: 'Немає доступу' }, { status: 403 })
  const { id } = await params
  const { data, error } = await createServiceClient().from('products').select('description').eq('id', id).single()
  if (error) return NextResponse.json({ error: 'Не вдалося прочитати товар' }, { status: 503 })
  return NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } })
}

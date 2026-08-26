import { redirect } from 'next/navigation'
import { getCurrentRole, canAccess } from '@/lib/getRole'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { thisWeekStart, weekStartOf } from '@/lib/schedule'
import ScheduleClient from './ScheduleClient'

export const dynamic = 'force-dynamic'

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>
}) {
  const role = await getCurrentRole()
  if (!canAccess('schedule', role)) redirect('/orders')

  const cookieStore = await cookies()
  const auth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  )
  const { data: { user } } = await auth.auth.getUser()
  if (!user) redirect('/login')

  const sp = await searchParams
  const week = sp.week && /^\d{4}-\d{2}-\d{2}$/.test(sp.week)
    ? weekStartOf(sp.week)
    : thisWeekStart()

  // The grid itself is fetched by the client, which also handles switching
  // weeks — going through the server for that would re-render the whole route
  // for data this page does not hold.
  return <ScheduleClient initialWeek={week} role={role ?? ''} meId={user.id} />
}

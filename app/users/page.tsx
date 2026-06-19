export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createServiceClient } from '@/lib/supabase/service'
import UsersManager from './UsersManager'

export default async function UsersPage() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const service = createServiceClient()
  const { data: profile } = await service.from('profiles').select('*').eq('id', user.id).single()

  if (!profile || !['super_admin', 'admin'].includes(profile.role)) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="text-4xl mb-4">🔒</div>
          <h1 className="text-white text-xl font-semibold mb-2">Доступ заборонено</h1>
          <p className="text-zinc-400 text-sm">Тільки адміністратори можуть керувати користувачами</p>
        </div>
      </div>
    )
  }

  const { data: users } = await service
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: true })

  return <UsersManager users={users || []} currentUserId={user.id} />
}

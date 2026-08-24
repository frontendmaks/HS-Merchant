import { redirect } from 'next/navigation'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createServiceClient } from '@/lib/supabase/service'
import { isAdmin, type UserRole } from '@/lib/getRole'
import { normalizeRequest } from '@/lib/requests'
import RequestsClient from './RequestsClient'

export const dynamic = 'force-dynamic'

const SELECT = `
  id, category, subject, description, status, priority, deadline,
  created_at, updated_at, completed_at, created_by, assigned_to,
  author:profiles!requests_created_by_fkey(id, full_name, email),
  assignee:profiles!requests_assigned_to_fkey(id, full_name, email),
  notes:request_notes(id, body, created_at, author_id,
                      author:profiles!request_notes_author_id_fkey(full_name, email))
`

export default async function RequestsPage() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll() {},
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const service = createServiceClient()
  const { data: me } = await service
    .from('profiles').select('id, full_name, email, role').eq('id', user.id).single()
  if (!me) redirect('/login')

  const admin = isAdmin(me.role as UserRole)

  let query = service.from('requests').select(SELECT).order('created_at', { ascending: false })
  if (!admin) query = query.or(`created_by.eq.${me.id},assigned_to.eq.${me.id}`)

  const [{ data: requests }, { data: people }] = await Promise.all([
    query,
    service.from('profiles')
      .select('id, full_name, email, role')
      .eq('is_active', true)
      .order('full_name'),
  ])

  return (
    <RequestsClient
      initialRequests={(requests ?? []).map(normalizeRequest)}
      people={people ?? []}
      me={me}
      isAdmin={admin}
    />
  )
}

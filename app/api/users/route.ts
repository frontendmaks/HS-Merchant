import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

async function getCallerProfile() {
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
  if (!user) return null
  const service = createServiceClient()
  const { data } = await service.from('profiles').select('*').eq('id', user.id).single()
  return data
}

// GET /api/users — list all users (admin only)
export async function GET() {
  const caller = await getCallerProfile()
  if (!caller || caller.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const service = createServiceClient()
  const { data, error } = await service.from('profiles').select('*').order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ users: data })
}

// POST /api/users — invite new user (admin only)
export async function POST(request: NextRequest) {
  const caller = await getCallerProfile()
  if (!caller || caller.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { email, full_name, role } = await request.json() as {
    email: string
    full_name: string
    role: 'admin' | 'operator' | 'viewer'
  }

  if (!email || !role) {
    return NextResponse.json({ error: 'Email та роль обовʼязкові' }, { status: 400 })
  }

  const service = createServiceClient()

  // Invite via Supabase Auth admin
  const { data: inviteData, error: inviteError } = await service.auth.admin.inviteUserByEmail(email, {
    data: { full_name, role },
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback?next=/`,
  })

  if (inviteError) {
    return NextResponse.json({ error: inviteError.message }, { status: 500 })
  }

  // Upsert profile (trigger should handle it, but just in case)
  if (inviteData.user) {
    await service.from('profiles').upsert({
      id: inviteData.user.id,
      email,
      full_name: full_name || '',
      role,
    }, { onConflict: 'id' })
  }

  return NextResponse.json({ success: true })
}

// PATCH /api/users — update role or status (admin only)
export async function PATCH(request: NextRequest) {
  const caller = await getCallerProfile()
  if (!caller || caller.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id, role, is_active, full_name } = await request.json() as {
    id: string
    role?: string
    is_active?: boolean
    full_name?: string
  }

  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  // Prevent demoting yourself
  if (id === caller.id && role && role !== 'admin') {
    return NextResponse.json({ error: 'Не можна змінити власну роль' }, { status: 400 })
  }

  const service = createServiceClient()
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (role) updates.role = role
  if (is_active !== undefined) updates.is_active = is_active
  if (full_name !== undefined) updates.full_name = full_name

  const { error } = await service.from('profiles').update(updates).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}

// DELETE /api/users — remove user (admin only)
export async function DELETE(request: NextRequest) {
  const caller = await getCallerProfile()
  if (!caller || caller.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await request.json() as { id: string }
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  if (id === caller.id) return NextResponse.json({ error: 'Не можна видалити себе' }, { status: 400 })

  const service = createServiceClient()
  const { error } = await service.auth.admin.deleteUser(id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}

import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Before anything else, and before any client is built: an icon or a script
  // needs no session, and asking for one on every asset multiplied the auth
  // traffic by however many files a page happens to load.
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.match(/\.(svg|png|ico|jpg|jpeg|webp)$/) ||
    pathname.startsWith('/api/auth') ||
    // These use the service-role key and check the caller themselves
    pathname.startsWith('/api/')
  ) {
    return NextResponse.next({ request })
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // The session is read from the token itself rather than by asking the Auth
  // service. This project signs with ES256, so the signature is verified here
  // against a cached public key — no network call, except when the token is
  // near expiry and genuinely needs refreshing.
  //
  // It was the round trip per request that took the whole panel down with it:
  // Auth slowed to ten seconds a call, every page and every asset waited on it,
  // and Vercel returned 504 for a site whose data was fine all along.
  //
  // The trade: a session revoked at Supabase stays usable here until its
  // access token expires, an hour at most.
  const { data } = await supabase.auth.getClaims()
  const user = data?.claims ? { id: data.claims.sub as string } : null

  // Login / set-password: redirect to home if already logged in (except set-password needs auth)
  if (pathname === '/login') {
    if (user) return NextResponse.redirect(new URL('/', request.url))
    return supabaseResponse
  }

  // Set password page — allowed for authenticated users (just accepted invite)
  if (pathname === '/set-password') {
    return supabaseResponse
  }

  // All other routes: require auth
  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
}

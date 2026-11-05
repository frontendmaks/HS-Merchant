import { accessTokenFromCookies, tokenNeedsRefresh, transientAuthError } from '@/lib/auth-session-cookie'
import { deadline, timedFetch } from '@/lib/http'
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Before anything else, and before any client is built: an icon or a script
  // needs no session, and asking for one on every asset multiplied the auth
  // traffic by however many files a page happens to load.
  if (
    pathname === '/login' || pathname === '/set-password' ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.match(/\.(svg|png|ico|jpg|jpeg|webp)$/) ||
    pathname.startsWith('/api/auth') ||
    // Бланк замовлення для складу: комірник не має акаунта в Мерчанті, а
    // замовлення отримати мусить. Захищає довгий випадковий токен у самій
    // адресі — сторінка перевіряє його й без нього нічого не показує.
    pathname.startsWith('/zamovlennya/') ||
    // Сторінка відгуку: її відкриває покупець, і акаунта в нього немає
    // й не буде. Захист той самий — токен у самій адресі.
    pathname.startsWith('/vidhuk/') ||
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
      global: { fetch: timedFetch(15000) },
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

  const token = accessTokenFromCookies(request.cookies.getAll(), process.env.NEXT_PUBLIC_SUPABASE_URL!)
  if (!token) return NextResponse.redirect(new URL('/login', request.url))
  try {
    // A still-valid token is verified directly; even the last 90 seconds of
    // its life do not require an Auth round trip just to open a page.
    // Do not race a token rotation against an abandoned response: wait for
    // the SDK's bounded refresh/retry cycle and return its Set-Cookie headers.
    const { data, error } = tokenNeedsRefresh(token)
      ? await supabase.auth.getClaims()
      : await deadline(supabase.auth.getClaims(token), 16000)
    if (error && transientAuthError(error)) return authUnavailable()
    if (!data?.claims?.sub) return NextResponse.redirect(new URL('/login', request.url))
    return supabaseResponse
  } catch {
    return authUnavailable()
  }
}

function authUnavailable() {
  // Fail closed without redirecting or deleting/overwriting refresh cookies.
  return new NextResponse(`<!doctype html><html lang="uk"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>HS Merchant — повторити запит</title><body style="font-family:system-ui;max-width:560px;margin:15vh auto;padding:24px"><h1>Тимчасова затримка авторизації</h1><p>Повторіть відкриття сторінки за кілька секунд. Повторно вводити пароль поки не потрібно.</p><button onclick="location.reload()" style="padding:12px 20px">Повторити</button></body></html>`,
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '3' } })
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
}

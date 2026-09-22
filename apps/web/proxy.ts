import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { env } from './lib/env';

// Refreshes the Supabase session cookie on every request and sends signed-out
// visitors to /login. Authorisation itself lives in the database (RLS).
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    env.supabaseUrl,
    env.supabaseAnonKey,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value } of list) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of list) response.cookies.set(name, value, options);
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);
  const path = request.nextUrl.pathname;

  if (!signedIn && !path.startsWith('/login')) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  // /login?error=... must stay reachable while signed in, or a user without a
  // company would bounce between / and /login forever.
  if (signedIn && path.startsWith('/login') && !request.nextUrl.searchParams.has('error')) {
    return NextResponse.redirect(new URL('/', request.url));
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/cron|.*\\.(?:svg|png|jpg|ico)$).*)'],
};

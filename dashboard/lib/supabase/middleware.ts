import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Runs on every matched request (see proxy.ts). Two jobs:
 *  1. Refresh the Supabase auth session cookie so Server Components see a
 *     fresh session.
 *  2. Gate: bounce logged-out users to /login. No roles here — this is an
 *     internal single-team tool, any authenticated user gets full access.
 */

// Reachable with no session at all — /login, and the two invite-link
// destinations (an invite lands here with NO session yet; that's the point).
const PUBLIC_PAGES = ["/login", "/auth/confirm", "/set-password"];
// Of those, only /login should bounce an ALREADY-logged-in visitor away — a
// signed-in admin poking at /set-password is fine to let through (they'd just
// see the form), and bouncing them mid-flow right after /auth/confirm just
// established their session would strand a brand-new invitee before they can
// ever set a password.
const REDIRECT_IF_LOGGED_IN = ["/login"];

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options));
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublicPage = PUBLIC_PAGES.some((p) => pathname.startsWith(p));

  if (!isPublicPage && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  if (REDIRECT_IF_LOGGED_IN.some((p) => pathname.startsWith(p)) && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

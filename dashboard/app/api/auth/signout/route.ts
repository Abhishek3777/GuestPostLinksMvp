import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrigin } from "@/lib/origin";

// Server-side sign-out: clears the Supabase session cookies via the response,
// so it doesn't depend on the browser client having its env vars baked in.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  // 303 so the browser follows the redirect with GET.
  return NextResponse.redirect(new URL("/login", getOrigin(request)), 303);
}

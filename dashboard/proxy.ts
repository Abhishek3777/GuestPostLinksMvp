import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Next.js 16: the middleware file is `proxy.ts` (not `middleware.ts`) and the
// exported function is `proxy` — same convention as the other Next.js apps.
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export default proxy;

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};

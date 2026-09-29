import { type EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Where Supabase's invite/magic-link/recovery emails point, IF the project's
// email template uses the modern {{ .TokenHash }}/{{ .Type }} link format.
// (Supabase's older default template instead links straight to its own
// hosted verify endpoint, which redirects with the session in the URL
// fragment — that case is handled entirely client-side by /set-password
// instead, this route is never hit for it.) Either way, the destination is
// the same: /set-password.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/set-password";

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) redirect(next);
  }

  redirect("/login");
}

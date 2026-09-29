"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// Where every invite link ends up (see team.service.ts's redirectTo, and
// /auth/confirm/route.ts). Two Supabase email-template shapes can land here:
//  - modern: /auth/confirm already exchanged the token server-side, so a
//    session cookie exists before this page even loads.
//  - legacy (Supabase's default template): the invite link points straight at
//    Supabase's own hosted verify page, which redirects here with the session
//    in the URL's #fragment. Fragments never reach the server, so only the
//    browser can see it — the Supabase browser client parses it and
//    establishes the session automatically on mount (detectSessionInUrl).
// Either way, by the time the check below runs client-side, a session should
// exist if the link was valid.
export default function SetPasswordPage() {
  const router = useRouter();
  const supabase = createClient();
  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(!!data.session);
      setChecking(false);
    });
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("Password must be at least 8 characters");
    if (password !== confirm) return setError("Passwords don't match");

    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (error) return setError(error.message);

    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-8">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-white">
            <Link2 size={18} />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-text">Guest Post Links</h1>
            <p className="text-sm text-muted">Set your password to finish joining</p>
          </div>
        </div>

        {checking ? (
          <div className="flex justify-center py-4">
            <Loader2 size={20} className="animate-spin text-muted" />
          </div>
        ) : !hasSession ? (
          <div className="flex flex-col gap-3 text-center">
            <p className="text-sm text-danger">This invite link is invalid or has expired.</p>
            <a href="/login" className="text-sm font-medium text-accent hover:underline">
              Back to sign in
            </a>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="password" className="text-sm font-medium text-text">
                New password
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text outline-none ring-accent/40 placeholder:text-muted focus:ring-2"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="confirm" className="text-sm font-medium text-text">
                Confirm password
              </label>
              <input
                id="confirm"
                type="password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text outline-none ring-accent/40 focus:ring-2"
              />
            </div>

            {error && <div className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</div>}

            <button
              type="submit"
              disabled={submitting}
              className="mt-1 flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {submitting && <Loader2 size={15} className="animate-spin" />}
              {submitting ? "Saving…" : "Set password & continue"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

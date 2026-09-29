import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

config({ path: ".env.local" });

// Creates (or resets the password of) a user in the AUTH project and makes
// them an admin in the DATA project's profiles table. The two are separate
// Supabase projects (see dashboard/.env.local) — this is the one script that
// bridges them correctly, so a login always ends up with a matching profile.
//
//   node scripts/bootstrap-admin.mjs email password

const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.error("Usage: node scripts/bootstrap-admin.mjs <email> <password>");
  process.exit(1);
}

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let found = null;
for (let page = 1; page <= 10 && !found; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
  if (error) throw error;
  found = data.users.find((u) => u.email === email) ?? null;
  if (data.users.length < 200) break;
}

let userId;
if (found) {
  const { data, error } = await admin.auth.admin.updateUserById(found.id, { password });
  if (error) throw error;
  userId = data.user.id;
  console.log("Existing user — password reset:", userId);
} else {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  userId = data.user.id;
  console.log("Created new user:", userId);
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false, ssl: "require", connection: { search_path: "guestpost" } });
await sql`
  insert into profiles (id, email, role)
  values (${userId}, ${email}, 'admin')
  on conflict (id) do update set role = 'admin', email = excluded.email
`;
await sql.end();

console.log(`Done — ${email} is admin. User ID: ${userId}`);

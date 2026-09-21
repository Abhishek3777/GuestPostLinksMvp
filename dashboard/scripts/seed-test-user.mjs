import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const email = process.argv[2];
const password = process.argv[3];

const { data, error } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});

if (error) {
  console.error("Error:", error.message);
  process.exit(1);
}

console.log("Created user:", data.user.id, data.user.email);

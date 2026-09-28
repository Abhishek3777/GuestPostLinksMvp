import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env" });

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  // This DB is shared with ORR (dev project) — keep drizzle-kit scoped to our
  // own "guestpost" schema so it never touches ORR's tables in "public".
  schemaFilter: ["guestpost"],
  dbCredentials: {
    // DIRECT (non-pooled, port 5432) connection — migrations need a real
    // session, not the transaction-mode pooler the app uses at runtime.
    url: process.env.DATABASE_URL_DIRECT!,
  },
});

import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env" });

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // DIRECT (non-pooled, port 5432) connection — migrations need a real
    // session, not the transaction-mode pooler the app uses at runtime.
    url: process.env.DATABASE_URL_DIRECT!,
  },
});

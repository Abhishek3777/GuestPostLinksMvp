import "dotenv/config";
import postgres from "postgres";

// A fresh, separate connection specifically for diagnostics, transaction-mode
// (6543) so it doesn't itself compete for the saturated session-mode pool.
const diagUrl = process.env.DATABASE_URL!.replace(":5432/", ":6543/") + "?pgbouncer=true";
const sql = postgres(diagUrl, { prepare: false, max: 1 });

const rows = await sql`
  select pid, usename, application_name, client_addr, state,
         now() - state_change as idle_duration,
         now() - backend_start as connection_age,
         left(query, 100) as query
  from pg_stat_activity
  where datname = current_database()
  order by backend_start;
`;
console.log(JSON.stringify(rows, null, 2));
await sql.end();
process.exit(0);

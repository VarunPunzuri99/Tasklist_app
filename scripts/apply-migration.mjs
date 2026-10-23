import { readFileSync } from "node:fs";
import { Client } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("Set DATABASE_URL to the Postgres connection string, then run npm run db:migrate.");
  process.exit(1);
}

const sql = readFileSync(new URL("../supabase/migrations/20261022120000_tasks.sql", import.meta.url), "utf8");
const client = new Client({ connectionString });

try {
  await client.connect();
  await client.query(sql);
  console.log("Applied supabase/migrations/20261022120000_tasks.sql");
} catch (error) {
  const message = error instanceof Error ? error.message : "Migration failed.";
  console.error(message);
  process.exitCode = 1;
} finally {
  await client.end();
}

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required. Set it in .env.local.");
}

// Use global singleton to prevent Next.js dev mode hot-reload from creating multiple connections
const globalForDb = globalThis as unknown as { pgClient: ReturnType<typeof postgres> };

if (!globalForDb.pgClient) {
  globalForDb.pgClient = postgres(connectionString, {
    prepare: false, // required for Supabase pgbouncer
    max: 10,        // transaction mode pooler allows more concurrent connections
  });
}

export const db = drizzle(globalForDb.pgClient, { schema });

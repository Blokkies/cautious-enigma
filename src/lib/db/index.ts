import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL!;

// Use global singleton to prevent Next.js dev mode hot-reload from creating multiple connections
const globalForDb = globalThis as unknown as { pgClient: ReturnType<typeof postgres> };

if (!globalForDb.pgClient) {
  globalForDb.pgClient = postgres(connectionString, {
    prepare: false, // required for Supabase pgbouncer
    max: 5,         // transaction mode pooler allows more concurrent connections
  });
}

export const db = drizzle(globalForDb.pgClient, { schema });

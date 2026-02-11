import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import bcrypt from "bcryptjs";
import * as schema from "./schema";
import path from "path";
import fs from "fs";

const DB_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "stocktake.db");

// Ensure data directory exists
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const sqlite = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

// Failsafe: ensure at least one admin user always exists
try {
  const row = sqlite.prepare("SELECT COUNT(*) as count FROM admins").get() as { count: number };
  if (row.count === 0) {
    const defaultPassword = process.env.ADMIN_PASSWORD || "admin2026";
    const hash = bcrypt.hashSync(defaultPassword, 10);
    sqlite.prepare("INSERT INTO admins (name, password_hash) VALUES (?, ?)").run("Admin", hash);
    console.log("[Failsafe] Default admin recreated — no admin users existed");
  }
} catch {
  // Table may not exist yet (pre-migration) — migrate.ts will handle seeding
}

export const db = drizzle(sqlite, { schema });

export { sqlite };

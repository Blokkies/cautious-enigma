import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import path from "path";
import fs from "fs";

const DB_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "stocktake.db");

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

const migration = `
CREATE TABLE IF NOT EXISTS stocktake_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  location TEXT,
  start_date TEXT,
  end_date TEXT,
  status TEXT NOT NULL DEFAULT 'setup' CHECK(status IN ('setup','active','completed','locked')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES stocktake_events(id),
  name TEXT NOT NULL,
  member1 TEXT,
  member2 TEXT,
  pin_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS supervisors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES stocktake_events(id),
  name TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  role TEXT DEFAULT 'supervisor',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES stocktake_events(id),
  item_code TEXT NOT NULL,
  description TEXT,
  brand TEXT,
  category TEXT,
  bin_number TEXT,
  warehouse TEXT,
  division TEXT,
  on_hand REAL DEFAULT 0,
  avg_cost REAL DEFAULT 0,
  total_value REAL DEFAULT 0,
  stock_status TEXT,
  serial_number TEXT,
  is_serialized INTEGER DEFAULT 0,
  team_id INTEGER REFERENCES teams(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS team_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES stocktake_events(id),
  team_id INTEGER NOT NULL REFERENCES teams(id),
  filter_type TEXT NOT NULL,
  filter_value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS counts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id),
  team_id INTEGER NOT NULL REFERENCES teams(id),
  event_id INTEGER NOT NULL REFERENCES stocktake_events(id),
  counted_qty REAL NOT NULL,
  variance REAL DEFAULT 0,
  variance_value REAL DEFAULT 0,
  is_match INTEGER DEFAULT 0,
  check_status TEXT DEFAULT 'pending' CHECK(check_status IN ('pending','accepted','recounted','queried')),
  comment TEXT,
  counted_at TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at TEXT,
  client_id TEXT
);

CREATE TABLE IF NOT EXISTS queries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES stocktake_events(id),
  team_id INTEGER NOT NULL REFERENCES teams(id),
  item_id INTEGER REFERENCES items(id),
  query_type TEXT NOT NULL CHECK(query_type IN ('missing_item','damaged','wrong_location','quantity_question','other')),
  message TEXT NOT NULL,
  response TEXT,
  responded_by INTEGER REFERENCES supervisors(id),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','escalated')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS breakdowns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES stocktake_events(id),
  team_id INTEGER NOT NULL REFERENCES teams(id),
  item_id INTEGER REFERENCES items(id),
  client_name TEXT,
  quantity REAL NOT NULL,
  po_number TEXT,
  reason TEXT,
  approval_status TEXT NOT NULL DEFAULT 'pending' CHECK(approval_status IN ('pending','approved','rejected')),
  approved_by INTEGER REFERENCES supervisors(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by INTEGER
);

CREATE TABLE IF NOT EXISTS verification_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  count_id INTEGER NOT NULL REFERENCES counts(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  event_id INTEGER NOT NULL REFERENCES stocktake_events(id),
  assigned_team_id INTEGER NOT NULL REFERENCES teams(id),
  assigned_by INTEGER NOT NULL REFERENCES supervisors(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','accepted')),
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER REFERENCES stocktake_events(id),
  user_id INTEGER,
  user_type TEXT CHECK(user_type IN ('team','supervisor','admin')),
  action TEXT NOT NULL,
  table_name TEXT,
  record_id INTEGER,
  old_value TEXT,
  new_value TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_items_event ON items(event_id);
CREATE INDEX IF NOT EXISTS idx_items_team ON items(team_id);
CREATE INDEX IF NOT EXISTS idx_items_bin ON items(bin_number);
CREATE INDEX IF NOT EXISTS idx_items_brand ON items(brand);
CREATE INDEX IF NOT EXISTS idx_items_code ON items(item_code);
CREATE INDEX IF NOT EXISTS idx_counts_item ON counts(item_id);
CREATE INDEX IF NOT EXISTS idx_counts_team ON counts(team_id);
CREATE INDEX IF NOT EXISTS idx_counts_event ON counts(event_id);
CREATE INDEX IF NOT EXISTS idx_counts_client_id ON counts(client_id);
CREATE INDEX IF NOT EXISTS idx_queries_event ON queries(event_id);
CREATE INDEX IF NOT EXISTS idx_queries_team ON queries(team_id);
CREATE INDEX IF NOT EXISTS idx_breakdowns_event ON breakdowns(event_id);
CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_log(event_id);
`;

// Migration for existing databases - add new columns if they don't exist
const alterStatements = [
  `ALTER TABLE items ADD COLUMN stock_status TEXT`,
  `ALTER TABLE items ADD COLUMN serial_number TEXT`,
  `ALTER TABLE items ADD COLUMN is_serialized INTEGER DEFAULT 0`,
  `ALTER TABLE counts ADD COLUMN count_type TEXT NOT NULL DEFAULT 'initial'`,
  `ALTER TABLE counts ADD COLUMN verification_id INTEGER`,
];

// Execute all statements
const statements = migration
  .split(";")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

for (const stmt of statements) {
  sqlite.exec(stmt + ";");
}

// Apply ALTER TABLE migrations (ignore errors if columns already exist)
for (const stmt of alterStatements) {
  try {
    sqlite.exec(stmt + ";");
  } catch {
    // Column already exists, ignore
  }
}

// Create indexes that depend on new columns (after ALTER TABLE)
const postAlterIndexes = [
  `CREATE INDEX IF NOT EXISTS idx_items_status ON items(stock_status)`,
  `CREATE INDEX IF NOT EXISTS idx_items_serialized ON items(is_serialized)`,
  `CREATE INDEX IF NOT EXISTS idx_items_warehouse ON items(warehouse)`,
  `CREATE INDEX IF NOT EXISTS idx_verification_event ON verification_assignments(event_id)`,
  `CREATE INDEX IF NOT EXISTS idx_verification_team ON verification_assignments(assigned_team_id)`,
  `CREATE INDEX IF NOT EXISTS idx_verification_item ON verification_assignments(item_id)`,
  `CREATE INDEX IF NOT EXISTS idx_counts_type ON counts(count_type)`,
  `CREATE INDEX IF NOT EXISTS idx_counts_verification ON counts(verification_id)`,
];
for (const idx of postAlterIndexes) {
  try {
    sqlite.exec(idx + ";");
  } catch {
    // ignore
  }
}

// Seed default admin if admins table is empty
const adminCount = sqlite.prepare("SELECT COUNT(*) as count FROM admins").get() as { count: number };
if (adminCount.count === 0) {
  const defaultPassword = process.env.ADMIN_PASSWORD || "admin2026";
  const hash = bcrypt.hashSync(defaultPassword, 10);
  sqlite.prepare("INSERT INTO admins (name, password_hash) VALUES (?, ?)").run("Admin", hash);
  console.log("Default admin seeded (name: Admin)");
}

console.log("Database migration completed successfully!");
console.log(`Database location: ${DB_PATH}`);

sqlite.close();

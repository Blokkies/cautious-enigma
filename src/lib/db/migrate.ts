import postgres from "postgres";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const connectionString = process.env.DATABASE_URL!;
if (!connectionString) {
  console.error("DATABASE_URL not set in .env.local");
  process.exit(1);
}

const sql = postgres(connectionString, { prepare: false });

const migration = `
CREATE TABLE IF NOT EXISTS stocktake_events (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT,
  start_date TEXT,
  end_date TEXT,
  status TEXT NOT NULL DEFAULT 'setup' CHECK(status IN ('setup','active','completed','locked')),
  created_at TEXT NOT NULL DEFAULT now(),
  updated_at TEXT NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS teams (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES stocktake_events(id),
  name TEXT NOT NULL,
  member1 TEXT,
  member2 TEXT,
  pin_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS supervisors (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES stocktake_events(id),
  name TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  role TEXT DEFAULT 'supervisor',
  created_at TEXT NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS items (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES stocktake_events(id),
  internal_id TEXT,
  item_code TEXT NOT NULL,
  description TEXT,
  brand TEXT,
  category TEXT,
  bin_number TEXT,
  warehouse TEXT,
  division TEXT,
  on_hand DOUBLE PRECISION DEFAULT 0,
  avg_cost DOUBLE PRECISION DEFAULT 0,
  total_value DOUBLE PRECISION DEFAULT 0,
  stock_status TEXT,
  serial_number TEXT,
  is_serialized BOOLEAN DEFAULT FALSE,
  team_id INTEGER REFERENCES teams(id),
  created_at TEXT NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS team_assignments (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES stocktake_events(id),
  team_id INTEGER NOT NULL REFERENCES teams(id),
  filter_type TEXT NOT NULL,
  filter_value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS counts (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id),
  team_id INTEGER NOT NULL REFERENCES teams(id),
  event_id INTEGER NOT NULL REFERENCES stocktake_events(id),
  counted_qty DOUBLE PRECISION NOT NULL,
  variance DOUBLE PRECISION DEFAULT 0,
  variance_value DOUBLE PRECISION DEFAULT 0,
  is_match BOOLEAN DEFAULT FALSE,
  check_status TEXT DEFAULT 'pending' CHECK(check_status IN ('pending','accepted','recounted','queried')),
  comment TEXT,
  counted_at TEXT NOT NULL DEFAULT now(),
  synced_at TEXT,
  client_id TEXT,
  count_type TEXT NOT NULL DEFAULT 'initial' CHECK(count_type IN ('initial','verification')),
  verification_id INTEGER
);

CREATE TABLE IF NOT EXISTS queries (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES stocktake_events(id),
  team_id INTEGER NOT NULL REFERENCES teams(id),
  item_id INTEGER REFERENCES items(id),
  item_code TEXT,
  query_type TEXT NOT NULL CHECK(query_type IN ('missing_item','damaged','wrong_location','quantity_question','other')),
  message TEXT NOT NULL,
  response TEXT,
  responded_by INTEGER REFERENCES supervisors(id),
  team_reply TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','escalated')),
  created_at TEXT NOT NULL DEFAULT now(),
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS query_messages (
  id SERIAL PRIMARY KEY,
  query_id INTEGER NOT NULL REFERENCES queries(id),
  sender_type TEXT NOT NULL CHECK(sender_type IN ('team','supervisor')),
  sender_id INTEGER NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS breakdowns (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES stocktake_events(id),
  team_id INTEGER NOT NULL REFERENCES teams(id),
  item_id INTEGER REFERENCES items(id),
  item_code TEXT,
  client_name TEXT,
  quantity DOUBLE PRECISION NOT NULL,
  po_number TEXT,
  reason TEXT,
  approval_status TEXT NOT NULL DEFAULT 'pending' CHECK(approval_status IN ('pending','approved','rejected')),
  approved_by INTEGER REFERENCES supervisors(id),
  created_at TEXT NOT NULL DEFAULT now(),
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS breakdown_messages (
  id SERIAL PRIMARY KEY,
  breakdown_id INTEGER NOT NULL REFERENCES breakdowns(id),
  sender_type TEXT NOT NULL CHECK(sender_type IN ('team','supervisor')),
  sender_id INTEGER NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admins (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT now(),
  created_by INTEGER
);

CREATE TABLE IF NOT EXISTS verification_assignments (
  id SERIAL PRIMARY KEY,
  count_id INTEGER NOT NULL REFERENCES counts(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  event_id INTEGER NOT NULL REFERENCES stocktake_events(id),
  assigned_team_id INTEGER NOT NULL REFERENCES teams(id),
  assigned_by INTEGER NOT NULL REFERENCES supervisors(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','accepted')),
  assigned_at TEXT NOT NULL DEFAULT now(),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  event_id INTEGER REFERENCES stocktake_events(id),
  user_id INTEGER,
  user_type TEXT CHECK(user_type IN ('team','supervisor','admin')),
  action TEXT NOT NULL,
  table_name TEXT,
  record_id INTEGER,
  old_value TEXT,
  new_value TEXT,
  created_at TEXT NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS serial_discrepancies (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES stocktake_events(id),
  team_id INTEGER NOT NULL REFERENCES teams(id),
  item_code TEXT NOT NULL,
  description TEXT,
  bin_number TEXT,
  unknown_serials TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
  resolution TEXT,
  resolved_by INTEGER REFERENCES supervisors(id),
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_items_event ON items(event_id);
CREATE INDEX IF NOT EXISTS idx_items_team ON items(team_id);
CREATE INDEX IF NOT EXISTS idx_items_bin ON items(bin_number);
CREATE INDEX IF NOT EXISTS idx_items_brand ON items(brand);
CREATE INDEX IF NOT EXISTS idx_items_code ON items(item_code);
CREATE INDEX IF NOT EXISTS idx_items_status ON items(stock_status);
CREATE INDEX IF NOT EXISTS idx_items_serialized ON items(is_serialized);
CREATE INDEX IF NOT EXISTS idx_items_warehouse ON items(warehouse);
CREATE INDEX IF NOT EXISTS idx_counts_item ON counts(item_id);
CREATE INDEX IF NOT EXISTS idx_counts_team ON counts(team_id);
CREATE INDEX IF NOT EXISTS idx_counts_event ON counts(event_id);
CREATE INDEX IF NOT EXISTS idx_counts_client_id ON counts(client_id);
CREATE INDEX IF NOT EXISTS idx_counts_type ON counts(count_type);
CREATE INDEX IF NOT EXISTS idx_counts_verification ON counts(verification_id);
CREATE INDEX IF NOT EXISTS idx_queries_event ON queries(event_id);
CREATE INDEX IF NOT EXISTS idx_queries_team ON queries(team_id);
CREATE INDEX IF NOT EXISTS idx_query_messages_query ON query_messages(query_id);
CREATE INDEX IF NOT EXISTS idx_breakdowns_event ON breakdowns(event_id);
CREATE INDEX IF NOT EXISTS idx_breakdowns_team ON breakdowns(team_id);
CREATE INDEX IF NOT EXISTS idx_breakdown_messages_breakdown ON breakdown_messages(breakdown_id);
CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_log(event_id);
CREATE INDEX IF NOT EXISTS idx_verification_event ON verification_assignments(event_id);
CREATE INDEX IF NOT EXISTS idx_verification_team ON verification_assignments(assigned_team_id);
CREATE INDEX IF NOT EXISTS idx_verification_item ON verification_assignments(item_id);
CREATE INDEX IF NOT EXISTS idx_serial_disc_event ON serial_discrepancies(event_id);
CREATE INDEX IF NOT EXISTS idx_serial_disc_status ON serial_discrepancies(status);
CREATE INDEX IF NOT EXISTS idx_serial_disc_item_code ON serial_discrepancies(item_code);
`;

const alterStatements = `
ALTER TABLE serial_discrepancies ADD COLUMN IF NOT EXISTS resolution_type TEXT;
ALTER TABLE serial_discrepancies ADD COLUMN IF NOT EXISTS approved_serials TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS bin_internal_id TEXT;
ALTER TABLE serial_discrepancies ADD COLUMN IF NOT EXISTS bin_internal_id TEXT;
ALTER TABLE stocktake_events ADD COLUMN IF NOT EXISTS warehouses TEXT;
CREATE INDEX IF NOT EXISTS idx_items_event_serial ON items(event_id, serial_number);
ALTER TABLE teams ADD COLUMN IF NOT EXISTS members TEXT;
ALTER TABLE serial_discrepancies ADD COLUMN IF NOT EXISTS verification_team_id INTEGER REFERENCES teams(id);
ALTER TABLE serial_discrepancies ADD COLUMN IF NOT EXISTS verification_assigned_by INTEGER REFERENCES supervisors(id);
ALTER TABLE serial_discrepancies ADD COLUMN IF NOT EXISTS verification_assigned_at TEXT;
ALTER TABLE serial_discrepancies ADD COLUMN IF NOT EXISTS verification_status TEXT;
ALTER TABLE serial_discrepancies ADD COLUMN IF NOT EXISTS verification_completed_at TEXT;
ALTER TABLE serial_discrepancies ADD COLUMN IF NOT EXISTS verified_serials TEXT;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS pin_plain TEXT;
ALTER TABLE supervisors ADD COLUMN IF NOT EXISTS pin_plain TEXT;
`;

const compositeIndexes = `
CREATE INDEX IF NOT EXISTS idx_items_event_team ON items(event_id, team_id);
CREATE INDEX IF NOT EXISTS idx_items_event_bin ON items(event_id, bin_number);
CREATE INDEX IF NOT EXISTS idx_counts_event_team ON counts(event_id, team_id);
CREATE INDEX IF NOT EXISTS idx_counts_event_match ON counts(event_id, is_match);
CREATE INDEX IF NOT EXISTS idx_counts_item_type ON counts(item_id, count_type);
CREATE INDEX IF NOT EXISTS idx_counts_event_type ON counts(event_id, count_type);
CREATE INDEX IF NOT EXISTS idx_verification_event_status ON verification_assignments(event_id, status);
CREATE INDEX IF NOT EXISTS idx_serial_disc_event_status ON serial_discrepancies(event_id, status);
CREATE INDEX IF NOT EXISTS idx_queries_event_status ON queries(event_id, status);
CREATE INDEX IF NOT EXISTS idx_breakdowns_event_status ON breakdowns(event_id, approval_status);
`;

// DO block must be executed as a single statement (contains semicolons)
const membersMigration = `
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teams' AND column_name='member1') THEN
    UPDATE teams SET members = CASE
      WHEN member1 IS NOT NULL AND member2 IS NOT NULL THEN '["' || member1 || '","' || member2 || '"]'
      WHEN member1 IS NOT NULL THEN '["' || member1 || '"]'
      WHEN member2 IS NOT NULL THEN '["' || member2 || '"]'
      ELSE NULL
    END WHERE members IS NULL AND (member1 IS NOT NULL OR member2 IS NOT NULL);
    ALTER TABLE teams DROP COLUMN IF EXISTS member1;
    ALTER TABLE teams DROP COLUMN IF EXISTS member2;
  END IF;
END $$;
`;

async function migrate() {
  console.log("Running PostgreSQL migration...");

  // Execute all statements
  const statements = migration
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    await sql.unsafe(stmt + ";");
  }

  // Execute ALTER statements for schema evolution
  const alters = alterStatements
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of alters) {
    await sql.unsafe(stmt + ";");
  }

  // Migrate member1/member2 → members (runs as single DO block)
  await sql.unsafe(membersMigration);

  // Execute composite indexes for query performance
  const ciStatements = compositeIndexes
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of ciStatements) {
    await sql.unsafe(stmt + ";");
  }

  // Seed default admin if admins table is empty
  const result = await sql`SELECT COUNT(*) as count FROM admins`;
  const adminCount = Number(result[0].count);
  if (adminCount === 0) {
    const defaultPassword = process.env.ADMIN_PASSWORD || "admin2026";
    const hash = bcrypt.hashSync(defaultPassword, 10);
    await sql`INSERT INTO admins (name, password_hash) VALUES ('Admin', ${hash})`;
    console.log("Default admin seeded (name: Admin)");
  }

  console.log("Database migration completed successfully!");
  await sql.end();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

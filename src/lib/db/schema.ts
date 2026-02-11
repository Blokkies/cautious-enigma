import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// ─── Stocktake Events ───────────────────────────────────────────────────────
export const stocktakeEvents = sqliteTable("stocktake_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  location: text("location"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  status: text("status", { enum: ["setup", "active", "completed", "locked"] })
    .notNull()
    .default("setup"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ─── Teams ──────────────────────────────────────────────────────────────────
export const teams = sqliteTable("teams", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventId: integer("event_id")
    .notNull()
    .references(() => stocktakeEvents.id),
  name: text("name").notNull(),
  member1: text("member1"),
  member2: text("member2"),
  pinHash: text("pin_hash").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ─── Supervisors ────────────────────────────────────────────────────────────
export const supervisors = sqliteTable("supervisors", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventId: integer("event_id")
    .notNull()
    .references(() => stocktakeEvents.id),
  name: text("name").notNull(),
  pinHash: text("pin_hash").notNull(),
  role: text("role").default("supervisor"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ─── Items (imported from NetSuite) ─────────────────────────────────────────
export const items = sqliteTable("items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventId: integer("event_id")
    .notNull()
    .references(() => stocktakeEvents.id),
  internalId: text("internal_id"),
  itemCode: text("item_code").notNull(),
  description: text("description"),
  brand: text("brand"),
  category: text("category"),
  binNumber: text("bin_number"),
  warehouse: text("warehouse"),
  division: text("division"),
  onHand: real("on_hand").default(0),
  avgCost: real("avg_cost").default(0),
  totalValue: real("total_value").default(0),
  stockStatus: text("stock_status"),
  serialNumber: text("serial_number"),
  isSerialized: integer("is_serialized", { mode: "boolean" }).default(false),
  teamId: integer("team_id").references(() => teams.id),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ─── Team Assignments (filter rules for bulk assignment) ────────────────────
export const teamAssignments = sqliteTable("team_assignments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventId: integer("event_id")
    .notNull()
    .references(() => stocktakeEvents.id),
  teamId: integer("team_id")
    .notNull()
    .references(() => teams.id),
  filterType: text("filter_type").notNull(), // bin, brand, category, warehouse, division
  filterValue: text("filter_value").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ─── Verification Assignments ────────────────────────────────────────────────
export const verificationAssignments = sqliteTable("verification_assignments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  countId: integer("count_id")
    .notNull()
    .references(() => counts.id),
  itemId: integer("item_id")
    .notNull()
    .references(() => items.id),
  eventId: integer("event_id")
    .notNull()
    .references(() => stocktakeEvents.id),
  assignedTeamId: integer("assigned_team_id")
    .notNull()
    .references(() => teams.id),
  assignedBy: integer("assigned_by")
    .notNull()
    .references(() => supervisors.id),
  status: text("status", { enum: ["pending", "completed", "accepted"] })
    .notNull()
    .default("pending"),
  assignedAt: text("assigned_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  completedAt: text("completed_at"),
});

// ─── Counts ─────────────────────────────────────────────────────────────────
export const counts = sqliteTable("counts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  itemId: integer("item_id")
    .notNull()
    .references(() => items.id),
  teamId: integer("team_id")
    .notNull()
    .references(() => teams.id),
  eventId: integer("event_id")
    .notNull()
    .references(() => stocktakeEvents.id),
  countedQty: real("counted_qty").notNull(),
  variance: real("variance").default(0),
  varianceValue: real("variance_value").default(0),
  isMatch: integer("is_match", { mode: "boolean" }).default(false),
  checkStatus: text("check_status", {
    enum: ["pending", "accepted", "recounted", "queried"],
  }).default("pending"),
  comment: text("comment"),
  countedAt: text("counted_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  syncedAt: text("synced_at"),
  clientId: text("client_id"), // for offline sync dedup
  countType: text("count_type", { enum: ["initial", "verification"] })
    .notNull()
    .default("initial"),
  verificationId: integer("verification_id"),
});

// ─── Queries (team-to-supervisor communication) ─────────────────────────────
export const queries = sqliteTable("queries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventId: integer("event_id")
    .notNull()
    .references(() => stocktakeEvents.id),
  teamId: integer("team_id")
    .notNull()
    .references(() => teams.id),
  itemId: integer("item_id").references(() => items.id),
  queryType: text("query_type", {
    enum: ["missing_item", "damaged", "wrong_location", "quantity_question", "other"],
  }).notNull(),
  message: text("message").notNull(),
  response: text("response"),
  respondedBy: integer("responded_by").references(() => supervisors.id),
  status: text("status", { enum: ["open", "resolved", "escalated"] })
    .notNull()
    .default("open"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  resolvedAt: text("resolved_at"),
});

// ─── Breakdowns (stock movements during count) ─────────────────────────────
export const breakdowns = sqliteTable("breakdowns", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventId: integer("event_id")
    .notNull()
    .references(() => stocktakeEvents.id),
  teamId: integer("team_id")
    .notNull()
    .references(() => teams.id),
  itemId: integer("item_id").references(() => items.id),
  clientName: text("client_name"),
  quantity: real("quantity").notNull(),
  poNumber: text("po_number"),
  reason: text("reason"),
  approvalStatus: text("approval_status", {
    enum: ["pending", "approved", "rejected"],
  })
    .notNull()
    .default("pending"),
  approvedBy: integer("approved_by").references(() => supervisors.id),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  resolvedAt: text("resolved_at"),
});

// ─── Admins ─────────────────────────────────────────────────────────────────
export const admins = sqliteTable("admins", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  createdBy: integer("created_by"),
});

// ─── Audit Log ──────────────────────────────────────────────────────────────
export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventId: integer("event_id").references(() => stocktakeEvents.id),
  userId: integer("user_id"),
  userType: text("user_type", { enum: ["team", "supervisor", "admin"] }),
  action: text("action").notNull(),
  tableName: text("table_name"),
  recordId: integer("record_id"),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ─── Serial Discrepancies ───────────────────────────────────────────────
export const serialDiscrepancies = sqliteTable("serial_discrepancies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventId: integer("event_id")
    .notNull()
    .references(() => stocktakeEvents.id),
  teamId: integer("team_id")
    .notNull()
    .references(() => teams.id),
  itemCode: text("item_code").notNull(),
  description: text("description"),
  binNumber: text("bin_number"),
  unknownSerials: text("unknown_serials").notNull(),
  status: text("status", { enum: ["open", "resolved"] })
    .notNull()
    .default("open"),
  resolution: text("resolution"),
  resolvedBy: integer("resolved_by").references(() => supervisors.id),
  resolvedAt: text("resolved_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ─── Type exports ───────────────────────────────────────────────────────────
export type StocktakeEvent = typeof stocktakeEvents.$inferSelect;
export type NewStocktakeEvent = typeof stocktakeEvents.$inferInsert;
export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;
export type Supervisor = typeof supervisors.$inferSelect;
export type NewSupervisor = typeof supervisors.$inferInsert;
export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
export type TeamAssignment = typeof teamAssignments.$inferSelect;
export type Count = typeof counts.$inferSelect;
export type NewCount = typeof counts.$inferInsert;
export type Query = typeof queries.$inferSelect;
export type NewQuery = typeof queries.$inferInsert;
export type Breakdown = typeof breakdowns.$inferSelect;
export type NewBreakdown = typeof breakdowns.$inferInsert;
export type Admin = typeof admins.$inferSelect;
export type NewAdmin = typeof admins.$inferInsert;
export type AuditLogEntry = typeof auditLog.$inferSelect;
export type VerificationAssignment = typeof verificationAssignments.$inferSelect;
export type NewVerificationAssignment = typeof verificationAssignments.$inferInsert;
export type SerialDiscrepancy = typeof serialDiscrepancies.$inferSelect;
export type NewSerialDiscrepancy = typeof serialDiscrepancies.$inferInsert;

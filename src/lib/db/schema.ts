import { pgTable, text, integer, serial, doublePrecision, boolean } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ─── Stocktake Events ───────────────────────────────────────────────────────
export const stocktakeEvents = pgTable("stocktake_events", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  location: text("location"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  status: text("status")
    .notNull()
    .default("setup"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`now()`),
  warehouses: text("warehouses"), // JSON array of selected warehouse names, null = all
  uploadId: integer("upload_id").references(() => uploads.id),
});

// ─── Teams ──────────────────────────────────────────────────────────────────
export const teams = pgTable("teams", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id")
    .notNull()
    .references(() => stocktakeEvents.id),
  name: text("name").notNull(),
  members: text("members"), // JSON array of member names e.g. ["Alice","Bob","Charlie"]
  pinHash: text("pin_hash").notNull(),
  pinPlain: text("pin_plain"), // Stored so supervisors can view assigned PINs
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()`),
});

// ─── Supervisors ────────────────────────────────────────────────────────────
export const supervisors = pgTable("supervisors", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id")
    .notNull()
    .references(() => stocktakeEvents.id),
  name: text("name").notNull(),
  pinHash: text("pin_hash").notNull(),
  pinPlain: text("pin_plain"), // Stored so supervisors can view assigned PINs
  role: text("role").default("supervisor"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()`),
});

// ─── Items (imported from NetSuite) ─────────────────────────────────────────
export const items = pgTable("items", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id")
    .notNull()
    .references(() => stocktakeEvents.id),
  internalId: text("internal_id"),
  itemCode: text("item_code").notNull(),
  description: text("description"),
  brand: text("brand"),
  category: text("category"),
  binNumber: text("bin_number"),
  binInternalId: text("bin_internal_id"),
  warehouse: text("warehouse"),
  division: text("division"),
  onHand: doublePrecision("on_hand").default(0),
  avgCost: doublePrecision("avg_cost").default(0),
  totalValue: doublePrecision("total_value").default(0),
  stockStatus: text("stock_status"),
  serialNumber: text("serial_number"),
  isSerialized: boolean("is_serialized").default(false),
  teamId: integer("team_id").references(() => teams.id),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()`),
});

// ─── Team Assignments (filter rules for bulk assignment) ────────────────────
export const teamAssignments = pgTable("team_assignments", {
  id: serial("id").primaryKey(),
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
    .default(sql`now()`),
});

// ─── Verification Assignments ────────────────────────────────────────────────
export const verificationAssignments = pgTable("verification_assignments", {
  id: serial("id").primaryKey(),
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
  status: text("status")
    .notNull()
    .default("pending"),
  assignedAt: text("assigned_at")
    .notNull()
    .default(sql`now()`),
  completedAt: text("completed_at"),
});

// ─── Counts ─────────────────────────────────────────────────────────────────
export const counts = pgTable("counts", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id")
    .notNull()
    .references(() => items.id),
  teamId: integer("team_id")
    .notNull()
    .references(() => teams.id),
  eventId: integer("event_id")
    .notNull()
    .references(() => stocktakeEvents.id),
  countedQty: doublePrecision("counted_qty").notNull(),
  variance: doublePrecision("variance").default(0),
  varianceValue: doublePrecision("variance_value").default(0),
  isMatch: boolean("is_match").default(false),
  checkStatus: text("check_status").default("pending"),
  comment: text("comment"),
  countedAt: text("counted_at")
    .notNull()
    .default(sql`now()`),
  syncedAt: text("synced_at"),
  clientId: text("client_id"), // for offline sync dedup
  countType: text("count_type")
    .notNull()
    .default("initial"),
  verificationId: integer("verification_id"),
  commentStatus: text("comment_status"),
});

// ─── Queries (team-to-supervisor communication) ─────────────────────────────
export const queries = pgTable("queries", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id")
    .notNull()
    .references(() => stocktakeEvents.id),
  teamId: integer("team_id")
    .notNull()
    .references(() => teams.id),
  itemId: integer("item_id").references(() => items.id),
  itemCode: text("item_code"),
  queryType: text("query_type").notNull(),
  message: text("message").notNull(),
  response: text("response"),
  respondedBy: integer("responded_by").references(() => supervisors.id),
  teamReply: text("team_reply"),
  status: text("status")
    .notNull()
    .default("open"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()`),
  resolvedAt: text("resolved_at"),
});

// ─── Query Messages (threaded conversation) ─────────────────────────────────
export const queryMessages = pgTable("query_messages", {
  id: serial("id").primaryKey(),
  queryId: integer("query_id")
    .notNull()
    .references(() => queries.id),
  senderType: text("sender_type").notNull(),
  senderId: integer("sender_id").notNull(),
  message: text("message").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()`),
});

// ─── Breakdowns (stock movements during count) ─────────────────────────────
export const breakdowns = pgTable("breakdowns", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id")
    .notNull()
    .references(() => stocktakeEvents.id),
  teamId: integer("team_id")
    .notNull()
    .references(() => teams.id),
  itemId: integer("item_id").references(() => items.id),
  itemCode: text("item_code"),
  clientName: text("client_name"),
  quantity: doublePrecision("quantity").notNull(),
  poNumber: text("po_number"),
  reason: text("reason"),
  approvalStatus: text("approval_status")
    .notNull()
    .default("pending"),
  approvedBy: integer("approved_by").references(() => supervisors.id),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()`),
  resolvedAt: text("resolved_at"),
});

// ─── Breakdown Messages ─────────────────────────────────────────────────────
export const breakdownMessages = pgTable("breakdown_messages", {
  id: serial("id").primaryKey(),
  breakdownId: integer("breakdown_id")
    .notNull()
    .references(() => breakdowns.id),
  senderType: text("sender_type").notNull(),
  senderId: integer("sender_id").notNull(),
  message: text("message").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()`),
});

// ─── Admins ─────────────────────────────────────────────────────────────────
export const admins = pgTable("admins", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()`),
  createdBy: integer("created_by"),
});

// ─── Audit Log ──────────────────────────────────────────────────────────────
export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").references(() => stocktakeEvents.id),
  userId: integer("user_id"),
  userType: text("user_type"),
  action: text("action").notNull(),
  tableName: text("table_name"),
  recordId: integer("record_id"),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()`),
});

// ─── Serial Discrepancies ───────────────────────────────────────────────
export const serialDiscrepancies = pgTable("serial_discrepancies", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id")
    .notNull()
    .references(() => stocktakeEvents.id),
  teamId: integer("team_id")
    .notNull()
    .references(() => teams.id),
  itemCode: text("item_code").notNull(),
  description: text("description"),
  binNumber: text("bin_number"),
  binInternalId: text("bin_internal_id"),
  unknownSerials: text("unknown_serials").notNull(),
  status: text("status")
    .notNull()
    .default("open"),
  resolution: text("resolution"),
  resolutionType: text("resolution_type"),
  approvedSerials: text("approved_serials"),
  resolvedBy: integer("resolved_by").references(() => supervisors.id),
  resolvedAt: text("resolved_at"),
  verificationTeamId: integer("verification_team_id").references(() => teams.id),
  verificationAssignedBy: integer("verification_assigned_by").references(() => supervisors.id),
  verificationAssignedAt: text("verification_assigned_at"),
  verificationStatus: text("verification_status"), // "pending" | "completed"
  verificationCompletedAt: text("verification_completed_at"),
  verifiedSerials: text("verified_serials"), // JSON: [{serial, status: "confirmed"|"not_found"}]
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()`),
});

// ─── Uploads (stored files) ─────────────────────────────────────────────────
export const uploads = pgTable("uploads", {
  id: serial("id").primaryKey(),
  filename: text("filename").notNull(),
  fileSize: integer("file_size").notNull(),
  fileData: text("file_data").notNull(), // base64-encoded file content
  mimeType: text("mime_type"),
  uploadedBy: integer("uploaded_by"), // admin id, nullable for legacy
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()`),
});

// ─── Executives ────────────────────────────────────────────────────────────
export const executives = pgTable("executives", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()`),
  createdBy: integer("created_by"),
});

// ─── Executive Messages (executive/admin ↔ supervisor chat) ───────────────
export const execMessages = pgTable("exec_messages", {
  id: serial("id").primaryKey(),
  senderId: integer("sender_id").notNull(),
  senderType: text("sender_type").notNull(), // 'executive' | 'supervisor' | 'admin'
  supervisorId: integer("supervisor_id")
    .notNull()
    .references(() => supervisors.id),
  eventId: integer("event_id")
    .notNull()
    .references(() => stocktakeEvents.id),
  message: text("message").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()`),
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
export type Executive = typeof executives.$inferSelect;
export type NewExecutive = typeof executives.$inferInsert;
export type ExecMessage = typeof execMessages.$inferSelect;
export type NewExecMessage = typeof execMessages.$inferInsert;
export type Upload = typeof uploads.$inferSelect;
export type NewUpload = typeof uploads.$inferInsert;

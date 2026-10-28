import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/** A PC / Mac / Linux machine running the TelePC agent. */
export const devices = pgTable("devices", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  platform: text("platform").notNull(),
  osRelease: text("os_release"),
  arch: text("arch"),
  agentVersion: text("agent_version"),
  token: text("token").notNull(),
  screenWidth: integer("screen_width"),
  screenHeight: integer("screen_height"),
  cpuCount: integer("cpu_count"),
  totalMemoryMb: integer("total_memory_mb"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Every command sent from the phone, with its outcome — the audit trail. */
export const commandLogs = pgTable(
  "command_logs",
  {
    id: text("id").primaryKey(),
    deviceId: text("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload"),
    ok: boolean("ok").notNull().default(true),
    result: jsonb("result"),
    error: text("error"),
    durationMs: integer("duration_ms"),
    source: text("source").notNull().default("phone"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("command_logs_device_created_idx").on(table.deviceId, table.createdAt)],
);

/** One-tap macros the user builds on the phone. */
export const shortcuts = pgTable(
  "shortcuts",
  {
    id: text("id").primaryKey(),
    deviceId: text("device_id").references(() => devices.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    emoji: text("emoji").notNull().default("⚡"),
    steps: jsonb("steps").notNull().$type<unknown[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("shortcuts_device_idx").on(table.deviceId)],
);

/** Small key/value store (pairing token, hub settings). */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DeviceRow = typeof devices.$inferSelect;
export type CommandLogRow = typeof commandLogs.$inferSelect;
export type ShortcutRow = typeof shortcuts.$inferSelect;

import DatabaseConstructor, { Database } from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { MigrationRunner } from "./migrations/runner.js";

export interface DatabaseHealthInfo {
  status: "ok" | "degraded" | "corrupt";
  journalMode: string;
  foreignKeys: boolean;
  busyTimeout: number;
  pageSize: number;
  pageCount: number;
  integrityCheck: string;
  quickCheck: string;
  migrationsVersion: number;
  checkedAt: number;
}

export function checkDatabaseHealth(db: Database): DatabaseHealthInfo {
  try {
    const journalMode =
      (db.pragma("journal_mode", { simple: true }) as string) || "unknown";
    const foreignKeys = Boolean(db.pragma("foreign_keys", { simple: true }));
    const busyTimeout = Number(
      db.pragma("busy_timeout", { simple: true }) || 0,
    );
    const pageSize = Number(db.pragma("page_size", { simple: true }) || 4096);
    const pageCount = Number(db.pragma("page_count", { simple: true }) || 0);

    const integrity =
      (db.pragma("integrity_check", { simple: true }) as string) || "error";
    const quick =
      (db.pragma("quick_check", { simple: true }) as string) || "error";

    let migrationVersion = 0;
    try {
      const row = db
        .prepare("SELECT MAX(version) as max_v FROM schema_migrations")
        .get() as any;
      migrationVersion = row?.max_v ?? 0;
    } catch {}

    const isOk = integrity === "ok" && quick === "ok";

    return {
      status: isOk ? "ok" : "corrupt",
      journalMode,
      foreignKeys,
      busyTimeout,
      pageSize,
      pageCount,
      integrityCheck: integrity,
      quickCheck: quick,
      migrationsVersion: migrationVersion,
      checkedAt: Date.now(),
    };
  } catch (err: any) {
    return {
      status: "corrupt",
      journalMode: "error",
      foreignKeys: false,
      busyTimeout: 0,
      pageSize: 0,
      pageCount: 0,
      integrityCheck: err.message,
      quickCheck: err.message,
      migrationsVersion: 0,
      checkedAt: Date.now(),
    };
  }
}

export function createDatabase(dbPath: string = ":memory:"): Database {
  if (dbPath !== ":memory:") {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new DatabaseConstructor(dbPath);
  db.pragma("busy_timeout = 5000");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");

  // Verify DB integrity at startup
  const integrity = db.pragma("integrity_check", { simple: true }) as string;
  if (integrity !== "ok") {
    throw new Error(
      `FATAL: SQLite database integrity check failed: ${integrity}`,
    );
  }
  const quick = db.pragma("quick_check", { simple: true }) as string;
  if (quick !== "ok") {
    throw new Error(`FATAL: SQLite database quick check failed: ${quick}`);
  }

  const runner = new MigrationRunner(db);
  runner.runMigrations();

  return db;
}

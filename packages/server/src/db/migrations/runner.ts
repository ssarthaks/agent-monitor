import { Database } from "better-sqlite3";
import { AppliedMigration, Migration } from "./types.js";
import { MIGRATIONS } from "./definitions.js";

export class MigrationRunner {
  constructor(private db: Database) {}

  initMigrationsTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
    `);
  }

  getAppliedMigrations(): AppliedMigration[] {
    this.initMigrationsTable();
    const rows = this.db
      .prepare(
        `SELECT id, name, applied_at FROM schema_migrations ORDER BY applied_at ASC`,
      )
      .all() as any[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      appliedAt: r.applied_at,
    }));
  }

  runMigrations(migrations: Migration[] = MIGRATIONS): {
    applied: string[];
    skipped: string[];
  } {
    this.initMigrationsTable();
    const appliedIds = new Set(this.getAppliedMigrations().map((m) => m.id));

    const applied: string[] = [];
    const skipped: string[] = [];

    for (const migration of migrations) {
      if (appliedIds.has(migration.id)) {
        skipped.push(migration.id);
        continue;
      }

      const tx = this.db.transaction(() => {
        migration.up(this.db);
        this.db
          .prepare(
            `INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)`,
          )
          .run(migration.id, migration.name, Date.now());
      });

      tx();
      applied.push(migration.id);
    }

    return { applied, skipped };
  }
}

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import DatabaseConstructor from "better-sqlite3";
import { MigrationRunner } from "../src/db/migrations/runner.js";
import { MIGRATIONS } from "../src/db/migrations/definitions.js";
import { createDatabase, checkDatabaseHealth } from "../src/db/database.js";

describe("Database Migrations (Phase 1)", () => {
  it("applies all migrations in order on a fresh database", () => {
    const db = new DatabaseConstructor(":memory:");
    const runner = new MigrationRunner(db);

    const result = runner.runMigrations();
    expect(result.applied).toEqual([
      "001_initial",
      "002_v03_controls",
      "003_v40_policy_versions",
      "004_v40_incidents",
      "005_v40_mcp_sources",
      "006_v40_idempotency_and_indexes",
      "007_v41_production_hardening",
    ]);
    expect(result.skipped).toEqual([]);

    const applied = runner.getAppliedMigrations();
    expect(applied.length).toBe(7);
    expect(applied[0].id).toBe("001_initial");
    expect(applied[6].id).toBe("007_v41_production_hardening");

    db.close();
  });

  it("is strictly idempotent when run repeatedly", () => {
    const db = createDatabase(":memory:");
    const runner = new MigrationRunner(db);

    // Second run should skip everything
    const secondRun = runner.runMigrations();
    expect(secondRun.applied).toEqual([]);
    expect(secondRun.skipped.length).toBe(7);

    db.close();
  });

  it("safely upgrades an existing V0.3 database preserving existing data", () => {
    const db = new DatabaseConstructor(":memory:");

    // Simulate pre-V4 table without hash and prev_hash
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        workspace_root TEXT NOT NULL,
        task TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        status TEXT NOT NULL,
        risk_score INTEGER DEFAULT 0,
        summary_json TEXT
      );

      CREATE TABLE events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        type TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        action_id TEXT,
        action_kind TEXT,
        payload_json TEXT NOT NULL,
        risk_level TEXT,
        risk_score INTEGER,
        risk_flags_json TEXT
      );

      CREATE TABLE approvals (
        id TEXT PRIMARY KEY,
        action_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        action_kind TEXT NOT NULL,
        category TEXT NOT NULL,
        params_json TEXT NOT NULL,
        risk_score INTEGER DEFAULT 0,
        risk_level TEXT,
        risk_flags_json TEXT,
        reason TEXT NOT NULL,
        matched_policies_json TEXT,
        status TEXT NOT NULL,
        resolved_by TEXT,
        created_at INTEGER NOT NULL,
        resolved_at INTEGER
      );

      INSERT INTO sessions (id, agent_id, agent_name, provider, model, workspace_root, task, started_at, status)
      VALUES ('ses_v03', 'agent_v03', 'Agent 0.3', 'mock', 'gpt-4o', '/workspace', 'task 1', 1000, 'running');

      INSERT INTO events (id, session_id, sequence, type, timestamp, payload_json)
      VALUES ('evt_1', 'ses_v03', 1, 'session.started', 1000, '{}');
    `);

    // Run V4 migration runner
    const runner = new MigrationRunner(db);
    const result = runner.runMigrations();
    expect(result.applied.length).toBe(7);

    // Verify existing data is preserved
    const session = db
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get("ses_v03") as any;
    expect(session).toBeDefined();
    expect(session.agent_name).toBe("Agent 0.3");

    // Verify new columns were added to events
    const event = db
      .prepare("SELECT id, hash, prev_hash FROM events WHERE id = ?")
      .get("evt_1") as any;
    expect(event).toBeDefined();
    expect(event.hash).toBeNull();
    expect(event.prev_hash).toBeNull();

    // Verify new V4 tables exist
    const incidents = db
      .prepare("SELECT COUNT(*) as count FROM incidents")
      .get() as any;
    expect(incidents.count).toBe(0);

    const mcpSources = db
      .prepare("SELECT COUNT(*) as count FROM mcp_sources")
      .get() as any;
    expect(mcpSources.count).toBe(0);

    const policyVersions = db
      .prepare("SELECT COUNT(*) as count FROM policy_versions")
      .get() as any;
    expect(policyVersions.count).toBe(0);

    db.close();
  });

  it("fails closed immediately at process startup if SQLite file is corrupted", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "corrupt-db-test-"));
    const dbPath = path.join(tmpDir, "corrupted.db");

    // 1. Create a valid SQLite database with all tables
    const dbValid = createDatabase(dbPath);
    dbValid.close();

    // 2. Corrupt the database file by overwriting pages with random junk
    const junk = Buffer.alloc(4096, 0xff);
    const fd = fs.openSync(dbPath, "r+");
    fs.writeSync(fd, junk, 0, junk.length, 100);
    fs.closeSync(fd);

    // 3. Attempt to initialize application via createDatabase()
    expect(() => createDatabase(dbPath)).toThrow(
      /FATAL: SQLite database.*check failed|file is not a database|database disk image is malformed/i,
    );

    // 4. Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

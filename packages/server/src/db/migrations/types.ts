import { Database } from "better-sqlite3";

export interface Migration {
  id: string; // e.g. "001_initial"
  name: string;
  up: (db: Database) => void;
}

export interface AppliedMigration {
  id: string;
  name: string;
  appliedAt: number;
}

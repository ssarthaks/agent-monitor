import path from "node:path";
import fs from "node:fs";
import pc from "picocolors";
import {
  createDatabase,
  SessionRepository,
  EventBus,
  MonitorServer,
} from "@agent-monitor/server";
import { resolveDatabasePath } from "../storage.js";

export interface ServerCommandOptions {
  port?: number;
  workspace?: string;
  db?: string;
}

export async function runServerCommand(
  options: ServerCommandOptions,
): Promise<void> {
  const workspaceRoot = path.resolve(options.workspace || process.cwd());
  const dbPath = resolveDatabasePath(workspaceRoot, { db: options.db });
  const serverPort =
    options.port || Number(process.env.AGENT_MONITOR_PORT) || 4040;

  const db = createDatabase(dbPath);
  const repository = new SessionRepository(db);
  const eventBus = new EventBus();

  const server = new MonitorServer({
    port: serverPort,
    repository,
    eventBus,
  });

  const { port } = await server.start();
  const sessions = repository.listSessions(10);

  console.log(
    "\n" +
      pc.bold(
        pc.cyan(
          "╔════════════════════════════════════════════════════════════════════╗",
        ),
      ),
  );
  console.log(
    pc.bold(pc.cyan("║")) +
      "  " +
      pc.bold(pc.white("AGENT MONITOR SERVER")) +
      " " +
      pc.dim("— Standalone Background Service") +
      "       " +
      pc.bold(pc.cyan("║")),
  );
  console.log(
    pc.bold(
      pc.cyan(
        "╚════════════════════════════════════════════════════════════════════╝",
      ),
    ),
  );
  console.log();
  console.log(`  ${pc.bold("Status:")}       ${pc.green("● Running")}`);
  console.log(
    `  ${pc.bold("Server API:")}   ${pc.underline(`http://127.0.0.1:${port}`)}`,
  );
  console.log(`  ${pc.bold("SQLite DB:")}    ${pc.dim(dbPath)}`);
  console.log(
    `  ${pc.bold("Sessions:")}     ${pc.yellow(sessions.length.toString())} stored session(s)`,
  );
  console.log();
  console.log(
    pc.dim("  Listening for agent events and dashboard connections..."),
  );
  console.log(pc.dim("  Press Ctrl+C to terminate server.\n"));

  // Clean, instantaneous shutdown on Ctrl+C (SIGINT / SIGTERM)
  const shutdown = async () => {
    console.log("\n  Stopping Agent Monitor Server...");
    try {
      await server.stop();
      db.close();
    } catch {
      // ignore
    } finally {
      process.exit(0);
    }
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

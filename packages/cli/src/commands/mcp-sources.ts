import path from "node:path";
import fs from "node:fs";
import pc from "picocolors";
import { createDatabase, SessionRepository } from "@agent-monitor/server";

export interface McpSourceCliOptions {
  workspace?: string;
  db?: string;
  json?: boolean;
}

function getRepo(options: McpSourceCliOptions): {
  repo: SessionRepository;
  close: () => void;
} {
  const workspaceRoot = path.resolve(options.workspace || process.cwd());
  const dbDir = path.join(workspaceRoot, ".agent-monitor");
  const dbPath = options.db
    ? path.resolve(options.db)
    : path.join(dbDir, "data.db");

  if (!fs.existsSync(dbPath)) {
    throw new Error(`SQLite database not found at: ${dbPath}`);
  }

  const db = createDatabase(dbPath);
  const repo = new SessionRepository(db);
  return { repo, close: () => db.close() };
}

export async function runMcpListSourcesCommand(
  options: McpSourceCliOptions = {},
): Promise<void> {
  const { repo, close } = getRepo(options);
  try {
    const sources = repo.listMcpSources();

    if (options.json) {
      console.log(JSON.stringify({ sources }, null, 2));
      return;
    }

    console.log(pc.bold("\nAGENT MONITOR — MCP Server Sources & Health\n"));
    if (sources.length === 0) {
      console.log(pc.dim("  No MCP server sources registered in database.\n"));
      return;
    }

    for (const src of sources) {
      const statusColor =
        src.status === "HEALTHY"
          ? pc.green
          : src.status === "QUARANTINED"
            ? pc.red
            : pc.yellow;

      console.log(
        `  ${pc.bold(src.sourceId)} [${statusColor(src.status)}] [Trust: ${src.trustState}]`,
      );
      console.log(
        `    Name: ${src.name} | Command: ${src.command} ${(src.args || []).join(" ")} | PID: ${src.pid || "n/a"}`,
      );
      console.log(
        `    Restarts: ${src.restartCount} | Consecutive Failures: ${src.consecutiveFailures} | Tools: ${src.toolCount}`,
      );
      if (src.quarantineReason) {
        console.log(
          `    Quarantine Reason: ${pc.red(src.quarantineReason)} (by ${src.quarantinedBy || "unknown"})`,
        );
      }
      console.log();
    }
  } finally {
    close();
  }
}

export async function runMcpShowSourceCommand(
  sourceId: string,
  options: McpSourceCliOptions = {},
): Promise<void> {
  const { repo, close } = getRepo(options);
  try {
    const source = repo.getMcpSource(sourceId);
    if (!source) {
      throw new Error(`MCP source '${sourceId}' not found`);
    }

    if (options.json) {
      console.log(JSON.stringify({ source }, null, 2));
      return;
    }

    const statusColor =
      source.status === "HEALTHY"
        ? pc.green
        : source.status === "QUARANTINED"
          ? pc.red
          : pc.yellow;

    console.log(pc.bold(`\nMCP SOURCE — ${source.sourceId}\n`));
    console.log(`  Name:                 ${source.name}`);
    console.log(`  Status:               ${statusColor(source.status)}`);
    console.log(`  Trust State:          ${source.trustState}`);
    console.log(`  Command:              ${source.command}`);
    console.log(`  Arguments:            ${(source.args || []).join(" ")}`);
    console.log(`  Working Directory:    ${source.cwd || "default"}`);
    console.log(`  PID:                  ${source.pid || "none"}`);
    console.log(`  Restarts:             ${source.restartCount}`);
    console.log(`  Consecutive Failures: ${source.consecutiveFailures}`);
    console.log(`  Tool Count:           ${source.toolCount}`);
    console.log(
      `  Last Seen:            ${new Date(source.lastSeen).toISOString()}`,
    );
    if (source.quarantineReason) {
      console.log(`  Quarantine Reason:    ${pc.red(source.quarantineReason)}`);
      console.log(
        `  Quarantined At:       ${source.quarantinedAt ? new Date(source.quarantinedAt).toISOString() : "unknown"}`,
      );
      console.log(
        `  Quarantined By:       ${source.quarantinedBy || "unknown"}`,
      );
    }
    console.log();
  } finally {
    close();
  }
}

export async function runMcpQuarantineCommand(
  sourceId: string,
  reason: string,
  options: McpSourceCliOptions = {},
): Promise<void> {
  const { repo, close } = getRepo(options);
  try {
    const updated = repo.quarantineSource(sourceId, reason, "operator-cli");

    if (options.json) {
      console.log(JSON.stringify({ success: true, source: updated }, null, 2));
      return;
    }

    console.log(
      pc.red(`\n⛔ MCP Source '${pc.bold(sourceId)}' is now QUARANTINED`),
    );
    console.log(`  Reason: ${reason}`);
    console.log(
      "  Downstream tool execution and resource reads are blocked immediately.\n",
    );
  } finally {
    close();
  }
}

export async function runMcpTrustCommand(
  sourceId: string,
  options: McpSourceCliOptions = {},
): Promise<void> {
  const { repo, close } = getRepo(options);
  try {
    const updated = repo.trustSource(sourceId);

    if (options.json) {
      console.log(JSON.stringify({ success: true, source: updated }, null, 2));
      return;
    }

    console.log(
      pc.green(
        `\n✓ MCP Source '${pc.bold(sourceId)}' is now TRUSTED and HEALTHY`,
      ),
    );
    console.log("  Quarantine lifted and execution boundary restored.\n");
  } finally {
    close();
  }
}

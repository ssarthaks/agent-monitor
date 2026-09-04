import path from "node:path";
import fs from "node:fs";
import pc from "picocolors";
import {
  PolicyEngine,
  RiskAnalyzer,
  BehavioralEngine,
  AgentEvent,
} from "@agent-monitor/core";
import {
  createDatabase,
  SessionRepository,
  EventBus,
  MonitorServer,
} from "@agent-monitor/server";
import { ApprovalManager, EventSink } from "@agent-monitor/agent";
import { McpStdioProxy } from "@agent-monitor/gateway";

export interface McpProxyCommandOptions {
  command: string[];
  workspace?: string;
  session?: string;
  db?: string;
  port?: number;
  config?: string;
  serverName?: string;
  server?: boolean;
}

export async function runMcpProxyCommand(
  options: McpProxyCommandOptions,
): Promise<void> {
  const args = options.command || [];
  if (args.length === 0) {
    process.stderr.write(
      pc.red("Error: No downstream command specified for MCP proxy.\n"),
    );
    process.stderr.write(
      pc.dim("Usage: agent-monitor mcp proxy -- <command> [args...]\n"),
    );
    process.stderr.write(
      pc.dim(
        "Example: agent-monitor mcp proxy -- npx -y @modelcontextprotocol/server-filesystem /path/to/dir\n",
      ),
    );
    process.exit(1);
  }

  const [cmd, ...cmdArgs] = args;
  const workspaceRoot = path.resolve(options.workspace || process.cwd());

  const dbDir = path.join(workspaceRoot, ".agent-monitor");
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const dbPath = options.db
    ? path.resolve(options.db)
    : path.join(dbDir, "data.db");
  const serverPort =
    options.port || Number(process.env.AGENT_MONITOR_PORT) || 4040;

  // Load Policy Configuration
  const configPath = options.config
    ? path.resolve(options.config)
    : path.join(workspaceRoot, "agent-monitor.config.json");

  let policyEngine: PolicyEngine;
  if (fs.existsSync(configPath)) {
    try {
      const config = PolicyEngine.loadFromFile(configPath);
      policyEngine = new PolicyEngine(config);
      process.stderr.write(
        pc.green(`[Agent Monitor] Loaded security policy from ${configPath}\n`),
      );
    } catch (err: any) {
      process.stderr.write(
        pc.yellow(
          `[Agent Monitor] Warning: Could not load ${configPath}: ${err.message}. Using defaults.\n`,
        ),
      );
      policyEngine = new PolicyEngine();
    }
  } else {
    policyEngine = new PolicyEngine();
  }

  // Database & Repository setup
  const db = createDatabase(dbPath);
  const repository = new SessionRepository(db);
  const eventBus = new EventBus();

  // Create or reuse session
  const sessionId =
    options.session ||
    `ses_mcp_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;

  const existingSession = repository.getSession(sessionId);
  if (!existingSession) {
    repository.createSession({
      id: sessionId,
      agentId: "mcp-client",
      agentName: options.serverName || path.basename(cmd),
      provider: "mcp",
      model: "external",
      workspaceRoot,
      task: `MCP Proxy for ${cmd} ${cmdArgs.join(" ")}`,
      startedAt: Date.now(),
      status: "running",
      riskScore: 0,
    });
  }

  // EventSink to persist and broadcast events
  const eventSink: EventSink = {
    async emit(event: AgentEvent): Promise<void> {
      repository.insertEvent(event);
      eventBus.publish(event);

      // Log security alerts to stderr
      if (event.type === "action.blocked") {
        process.stderr.write(
          pc.bold(
            pc.red(
              `\n🚨 [SECURITY BLOCKED] Action '${event.kind}' blocked: ${event.reason}\n`,
            ),
          ),
        );
      } else if (event.type === "tool.changed") {
        process.stderr.write(
          pc.bold(
            pc.yellow(
              `\n⚠️  [TOOL MUTATION DETECTED] Tool '${event.toolName}' schema changed (${event.previousFingerprint.substring(0, 8)} -> ${event.newFingerprint.substring(0, 8)})\n`,
            ),
          ),
        );
      } else if (event.type === "behavioral.match") {
        process.stderr.write(
          pc.bold(
            pc.red(
              `\n⚠️  [BEHAVIORAL SEQUENCE MATCH] ${event.match.name} (${event.match.severity}): ${event.match.reason}\n`,
            ),
          ),
        );
      }
    },
  };

  // Optional background monitor server
  let server: MonitorServer | null = null;
  if (options.server !== false) {
    server = new MonitorServer({
      port: serverPort,
      repository,
      eventBus,
      policyEngine,
    });
    try {
      const { port } = await server.start();
      process.stderr.write(
        pc.cyan(
          `[Agent Monitor] Monitor Server running at http://127.0.0.1:${port} (Session: ${sessionId})\n`,
        ),
      );
    } catch (err: any) {
      process.stderr.write(
        pc.yellow(
          `[Agent Monitor] Note: Background HTTP server port busy (${err.message}). Continuing in headless proxy mode.\n`,
        ),
      );
    }
  }

  const approvalManager = new ApprovalManager({
    storage: repository,
    timeoutMs: 120_000,
  });

  const behavioralEngine = new BehavioralEngine();
  const riskAnalyzer = new RiskAnalyzer();

  // Rehydrate behavioral engine from historical events if session already had events
  const pastEvents = repository.getEventsBySession(sessionId, 0);
  if (pastEvents.length > 0) {
    behavioralEngine.reconstructFromEvents(sessionId, pastEvents);
  }

  const proxy = new McpStdioProxy({
    command: cmd,
    args: cmdArgs,
    cwd: workspaceRoot,
    sessionId,
    agentId: "mcp-client",
    serverName: options.serverName || cmd,
    workspaceRoot,
    repository,
    eventSink,
    approvalManager,
    policyEngine,
    riskAnalyzer,
    behavioralEngine,
    clientInputStream: process.stdin,
    clientOutputStream: process.stdout,
    logStream: process.stderr,
  });

  process.stderr.write(
    pc.bold(
      pc.cyan(
        `[Agent Monitor V0.3] Transparent MCP Control Boundary activated for '${cmd}'.\n`,
      ),
    ),
  );

  const cleanup = async () => {
    try {
      await proxy.stop();
      if (server) {
        await server.stop();
      }
      db.close();
    } catch {
      // ignore
    }
  };

  process.on("SIGINT", async () => {
    process.stderr.write(
      pc.yellow(
        "\n[Agent Monitor] Caught SIGINT, shutting down MCP proxy...\n",
      ),
    );
    await cleanup();
    process.exit(130);
  });

  process.on("SIGTERM", async () => {
    await cleanup();
    process.exit(143);
  });

  await proxy.start();
}

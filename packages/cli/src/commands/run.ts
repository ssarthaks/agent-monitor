import path from "node:path";
import fs from "node:fs";
import readline from "node:readline";
import pc from "picocolors";
import {
  AgentEvent,
  AgentSession,
  SessionEndedEvent,
  RiskAnalyzer,
  PolicyEngine,
  ApprovalRequest,
} from "@agent-monitor/core";
import {
  createDatabase,
  SessionRepository,
  EventBus,
  MonitorServer,
} from "@agent-monitor/server";
import {
  ActionInterceptor,
  ApprovalManager,
  DeepSeekCodingAgent,
  DeepSeekClient,
  readFileTool,
  writeFileTool,
  listFilesTool,
  runCommandTool,
} from "@agent-monitor/agent";
import {
  printStartupBanner,
  printLiveEvent,
  printSummaryBanner,
} from "../banner.js";

export interface RunCommandOptions {
  task: string;
  workspace?: string;
  port?: number;
  webPort?: number;
  db?: string;
  config?: string;
  model?: string;
  apiKey?: string;
  keepAlive?: boolean;
}

function loadEnvFiles(workspaceRoot: string) {
  const envCandidates = [
    path.join(process.cwd(), ".env.local"),
    path.join(process.cwd(), ".env"),
    path.join(workspaceRoot, ".env.local"),
    path.join(workspaceRoot, ".env"),
  ];

  for (const file of envCandidates) {
    if (fs.existsSync(file)) {
      try {
        const content = fs.readFileSync(file, "utf8");
        for (const line of content.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const eqIdx = trimmed.indexOf("=");
          if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            const val = trimmed
              .slice(eqIdx + 1)
              .trim()
              .replace(/^["']|["']$/g, "");
            if (key && val && !process.env[key]) {
              process.env[key] = val;
            }
          }
        }
      } catch {
        // ignore
      }
    }
  }
}

export async function runAgentCommand(
  options: RunCommandOptions,
): Promise<void> {
  const workspaceRoot = path.resolve(options.workspace || process.cwd());
  loadEnvFiles(workspaceRoot);

  const dbDir = path.join(workspaceRoot, ".agent-monitor");
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const dbPath = options.db
    ? path.resolve(options.db)
    : path.join(dbDir, "data.db");
  const serverPort =
    options.port || Number(process.env.AGENT_MONITOR_PORT) || 4040;
  const webPort = options.webPort || Number(process.env.PORT) || 3000;
  const model = options.model || process.env.DEEPSEEK_MODEL || "deepseek-chat";
  const apiKey = options.apiKey || process.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    console.error("\n❌ ERROR: DEEPSEEK_API_KEY is required to run the agent.");
    console.error(
      "Please add DEEPSEEK_API_KEY to your .env or .env.local file, or export it in your shell.\n",
    );
    process.exit(1);
  }

  // 1. Load Policy Configuration
  const configPath = options.config
    ? path.resolve(options.config)
    : path.join(workspaceRoot, "agent-monitor.config.json");

  let policyEngine: PolicyEngine;
  if (fs.existsSync(configPath)) {
    try {
      const config = PolicyEngine.loadFromFile(configPath);
      policyEngine = new PolicyEngine(config);
    } catch (err: any) {
      console.error(
        pc.red(`\n❌ Policy Configuration Error: ${err.message}\n`),
      );
      process.exit(1);
    }
  } else {
    policyEngine = new PolicyEngine();
  }

  // 2. Initialize SQLite Database & Repositories
  const db = createDatabase(dbPath);
  const repository = new SessionRepository(db);
  const eventBus = new EventBus();

  // 3. Start Monitor Server or reuse running server if EADDRINUSE
  let server: MonitorServer | null = null;
  let serverUrl = `http://127.0.0.1:${serverPort}`;

  try {
    server = new MonitorServer({
      port: serverPort,
      repository,
      eventBus,
      policyEngine,
    });
    const { port: actualPort } = await server.start();
    serverUrl = `http://127.0.0.1:${actualPort}`;
  } catch (err: any) {
    if (err.code === "EADDRINUSE") {
      server = null;
    } else {
      throw err;
    }
  }

  // The dashboard is embedded and served directly by MonitorServer on serverUrl (e.g. http://127.0.0.1:4040).
  // Only override if the user explicitly specified a custom webPort via CLI options.
  const dashboardBase = options.webPort
    ? `http://localhost:${options.webPort}`
    : serverUrl;
  const dashboardUrl = `${dashboardBase}/?sessionId=`;

  const sessionId = `ses_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
  const agentId = "deepseek-coding-agent";
  const agentName = "DeepSeek Coding Agent";
  const startTime = Date.now();

  const session: AgentSession = {
    id: sessionId,
    agentId,
    agentName,
    provider: "deepseek",
    model,
    workspaceRoot,
    task: options.task,
    startedAt: startTime,
    status: "running",
    riskScore: 0,
  };

  repository.createSession(session);

  // If an external background server is running, notify it of session creation
  if (!server) {
    try {
      fetch(`${serverUrl}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(session),
      }).catch(() => {});
    } catch {
      // ignore
    }
  }

  // 4. Connect Terminal Logger to EventBus
  eventBus.subscribe(sessionId, (event) => {
    printLiveEvent(event);
  });

  // 5. Setup ApprovalManager with Terminal Prompt & SQLite Storage
  let activeReadline: readline.Interface | null = null;

  const approvalManager = new ApprovalManager({
    storage: repository,
    timeoutMs: policyEngine.getTimeoutMs(),
    onApprovalRequested: async (approval: ApprovalRequest) => {
      console.log(
        "\n" +
          pc.bold(
            pc.yellow(
              "──────────────────────────────────────────────────────────────────────\n" +
                "⚠️  HUMAN APPROVAL REQUIRED (V0.2 Policy Gate)\n" +
                "──────────────────────────────────────────────────────────────────────",
            ),
          ),
      );
      console.log(
        `  ${pc.bold("Action:")}     ${pc.cyan(approval.actionKind)}`,
      );
      if (approval.params.command) {
        console.log(
          `  ${pc.bold("Command:")}    ${pc.white(approval.params.command)}`,
        );
      }
      if (approval.params.path) {
        console.log(
          `  ${pc.bold("Path:")}       ${pc.white(approval.params.path)}`,
        );
      }
      console.log(
        `  ${pc.bold("Risk Score:")} ${pc.red(`${approval.risk.score}/100 (${approval.risk.level})`)}`,
      );
      console.log(
        `  ${pc.bold("Policy:")}     ${pc.yellow(approval.matchedPolicies.join(", ") || "custom rule")}`,
      );
      console.log(`  ${pc.bold("Reason:")}     ${pc.white(approval.reason)}`);
      console.log();
      console.log(
        pc.dim("  You can also approve/deny from the web dashboard."),
      );

      if (!process.stdin.isTTY) {
        console.log(
          pc.bold(
            pc.cyan(
              `  👉 Non-interactive terminal detected. Please approve/deny in Web Dashboard:`,
            ),
          ),
        );
        console.log(
          pc.bold(pc.underline(pc.cyan(`     ${dashboardUrl}${sessionId}`))),
        );
        return;
      }

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      activeReadline = rl;

      let isClosed = false;
      const closePrompt = () => {
        if (!isClosed) {
          isClosed = true;
          try {
            rl.close();
          } catch {
            // ignore
          }
          if (activeReadline === rl) {
            activeReadline = null;
          }
        }
      };

      // Fix 4: Listen on EventBus; if resolved externally via web UI or timeout, close prompt!
      const unsubscribe = eventBus.subscribe(sessionId, (event) => {
        if (
          event.type === "approval.resolved" &&
          (event as any).approvalId === approval.id
        ) {
          closePrompt();
          unsubscribe();
        }
      });

      const askLoop = () => {
        if (isClosed) return;
        rl.question(
          pc.bold(pc.yellow("  Allow this action? [y/n]: ")),
          (answer) => {
            if (isClosed) return;
            const trimmed = answer.trim().toLowerCase();
            if (trimmed === "y" || trimmed === "yes") {
              unsubscribe();
              closePrompt();
              approvalManager.resolve(approval.id, "approved", "user_terminal");
            } else if (trimmed === "n" || trimmed === "no") {
              unsubscribe();
              closePrompt();
              approvalManager.resolve(approval.id, "denied", "user_terminal");
            } else {
              console.log(
                pc.dim(
                  `  Type 'y' to approve, 'n' to deny, or approve in Web UI: ${dashboardUrl}${sessionId}`,
                ),
              );
              askLoop();
            }
          },
        );
      };

      askLoop();
    },
    onApprovalResolved: async (approval, decision, resolvedBy) => {
      // Fix 2: Authoritative resolution from CLI or timeout
      if (activeReadline) {
        try {
          activeReadline.close();
        } catch {
          // ignore
        }
        activeReadline = null;
      }

      // Check if event was already inserted (e.g. By HTTP server)
      const existingEvents = repository.getEventsBySession(sessionId);
      const alreadyEmitted = existingEvents.some(
        (e) =>
          e.type === "approval.resolved" &&
          (e as any).approvalId === approval.id,
      );

      if (!alreadyEmitted) {
        const resolvedEv: AgentEvent = {
          id: `evt_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
          sequence: repository.getNextSequence(sessionId),
          sessionId,
          agentId,
          timestamp: Date.now(),
          type: "approval.resolved",
          approvalId: approval.id,
          actionId: approval.actionId,
          decision,
          resolvedBy,
        };
        repository.insertEvent(resolvedEv);
        eventBus.publish(resolvedEv);

        if (!server) {
          try {
            fetch(`${serverUrl}/sessions/${sessionId}/events`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(resolvedEv),
            }).catch(() => {});
          } catch {
            // ignore
          }
        }
      }
    },
  });

  // 6. Setup Action Interceptor with PolicyEngine & ApprovalManager
  const interceptor = new ActionInterceptor({
    sink: {
      emit: async (event: AgentEvent) => {
        if (!event.sequence) {
          (event as any).sequence = repository.getNextSequence(sessionId);
        }
        repository.insertEvent(event);
        eventBus.publish(event);

        if (!server) {
          try {
            fetch(`${serverUrl}/sessions/${sessionId}/events`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(event),
            }).catch(() => {});
          } catch {
            // ignore
          }
        }
      },
    },
    riskAnalyzer: new RiskAnalyzer(),
    policyEngine,
    approvalManager,
  });

  // Register the 4 tools
  interceptor.registerTool(readFileTool);
  interceptor.registerTool(writeFileTool);
  interceptor.registerTool(listFilesTool);
  interceptor.registerTool(runCommandTool);

  // Emit session.started
  await interceptor.emitSessionStarted({
    sessionId,
    agentId,
    agentName,
    provider: "deepseek",
    model,
    workspaceRoot,
    task: options.task,
    timestamp: startTime,
  });

  printStartupBanner(session, serverUrl, `${dashboardUrl}${sessionId}`);

  // 7. Initialize and Run DeepSeek Agent
  const client = new DeepSeekClient(apiKey);
  const agent = new DeepSeekCodingAgent({
    client,
    interceptor,
    context: {
      sessionId,
      agentId,
      workspaceRoot,
    },
    model,
  });

  let sessionStatus: AgentSession["status"] = "completed";

  try {
    await agent.run(options.task);
  } catch (err: any) {
    sessionStatus = "failed";
    console.error(`\n❌ Agent encountered an error: ${err.message}`);
  }

  // 8. Compute Session Summary
  const allEvents = repository.getEventsBySession(sessionId);
  const durationMs = Date.now() - startTime;

  let filesRead = 0;
  let filesWritten = 0;
  let commandsRun = 0;
  let errorsCount = 0;
  let approvedCount = 0;
  let blockedCount = 0;
  let overallRiskScore = 0;

  for (const ev of allEvents) {
    if (ev.type === "action.started" || ev.type === "action.completed") {
      if (ev.risk && ev.risk.score > overallRiskScore) {
        overallRiskScore = ev.risk.score;
      }
    }
    if (ev.type === "action.completed") {
      if (ev.kind === "file.read") filesRead++;
      if (ev.kind === "file.write") filesWritten++;
      if (ev.kind === "process.exec") commandsRun++;
    }
    if (ev.type === "approval.resolved" && ev.decision === "approved") {
      approvedCount++;
    }
    if (ev.type === "action.blocked") {
      blockedCount++;
    }
    if (ev.type === "action.failed" || ev.type === "action.blocked") {
      errorsCount++;
    }
  }

  const usage = agent.getUsage();

  const summary: SessionEndedEvent["summary"] & {
    approvedCount?: number;
    blockedCount?: number;
  } = {
    totalActions: filesRead + filesWritten + commandsRun,
    filesRead,
    filesWritten,
    commandsRun,
    errorsCount,
    overallRiskScore,
    approvedCount,
    blockedCount,
    usage: usage.totalTokens > 0 ? usage : undefined,
  };

  await interceptor.emitSessionEnded({
    sessionId,
    agentId,
    timestamp: Date.now(),
    status: sessionStatus,
    durationMs,
    summary,
  });

  printSummaryBanner(summary, durationMs);

  if (server && options.keepAlive) {
    console.log(
      pc.bold(
        pc.cyan(`  ● Monitor server running at: ${pc.underline(serverUrl)}`),
      ),
    );
    console.log(
      pc.bold(
        pc.cyan(
          `  ● Open Dashboard at:         ${pc.underline(`${dashboardUrl}${sessionId}`)}`,
        ),
      ),
    );
    console.log(pc.dim("  Press Ctrl+C to stop the server.\n"));

    await new Promise<void>((resolve) => {
      process.on("SIGINT", () => resolve());
    });
  }

  if (server) {
    await server.stop();
  }
  db.close();
}

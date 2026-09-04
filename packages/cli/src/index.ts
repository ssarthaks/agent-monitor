#!/usr/bin/env node
import { Command } from "commander";
import { runAgentCommand } from "./commands/run.js";
import { runServerCommand } from "./commands/server.js";
import { runPolicyCheckCommand } from "./commands/check.js";
import {
  runConfigInitCommand,
  runConfigValidateCommand,
} from "./commands/config.js";
import { runSessionsCommand } from "./commands/sessions.js";
import { runStatusCommand } from "./commands/status.js";
import { runMcpProxyCommand } from "./commands/mcp.js";
import { runKillCommand, runResumeCommand } from "./commands/kill.js";
import { runToolsCommand } from "./commands/tools.js";
import { runSecurityFlowsCommand } from "./commands/security.js";

const program = new Command();

program
  .name("agent-monitor")
  .description(
    "Agent Monitor — Activity Monitor & Deterministic Policy Gate for AI Agents (V0.3 UNIVERSAL CONTROL BOUNDARY)",
  )
  .version("0.2.1");

// 1. Run Agent Task with Policy Monitoring
program
  .command("run")
  .description(
    "Run an autonomous coding agent with real-time activity monitoring, policy enforcement, and human approvals",
  )
  .requiredOption(
    "-t, --task <task>",
    "The task or prompt for the agent to execute",
  )
  .option(
    "-w, --workspace <path>",
    "Workspace directory path (defaults to current working directory)",
  )
  .option(
    "-p, --port <port>",
    "Monitor Server API port",
    (val) => parseInt(val, 10),
    4040,
  )
  .option(
    "--web-port <port>",
    "Custom external dashboard web port (defaults to server port)",
    (val) => parseInt(val, 10),
  )
  .option("--model <model>", "DeepSeek model name", "deepseek-chat")
  .option("--db <path>", "Custom SQLite database file path")
  .option("-c, --config <path>", "Path to agent-monitor.config.json")
  .option(
    "--keep-alive",
    "Keep the monitor server running after the agent task finishes",
  )
  .action(async (options) => {
    try {
      await runAgentCommand({
        task: options.task,
        workspace: options.workspace,
        port: options.port,
        webPort: options.webPort,
        model: options.model,
        db: options.db,
        config: options.config,
        keepAlive: options.keepAlive,
      });
    } catch (err: any) {
      console.error(`\n❌ Error: ${err.message}`);
      process.exit(1);
    }
  });

// 2. Standalone Background Server & Web DevTools
program
  .command("server")
  .description(
    "Start the standalone Monitor Server to serve SQLite session history, embedded DevTools UI, and live SSE",
  )
  .option(
    "-p, --port <port>",
    "Monitor Server API port",
    (val) => parseInt(val, 10),
    4040,
  )
  .option("-w, --workspace <path>", "Workspace directory path", process.cwd())
  .option("--db <path>", "Custom SQLite database file path")
  .action(async (options) => {
    try {
      await runServerCommand({
        port: options.port,
        workspace: options.workspace,
        db: options.db,
      });
    } catch (err: any) {
      console.error(`\n❌ Error: ${err.message}`);
      process.exit(1);
    }
  });

// 3. Policy Commands (`agent-monitor policy check`)
const policyCmd = program
  .command("policy")
  .description("Inspect, test, and simulate deterministic security policies");

policyCmd
  .command("check")
  .description(
    "Simulate policy evaluation on a target action/command without executing it (Dry Run)",
  )
  .option(
    "-a, --action <action>",
    "Action kind (e.g. process.exec, file.read, file.write)",
    "process.exec",
  )
  .option(
    "-c, --command <command>",
    'Target command to evaluate (e.g. "git push origin main", "npm test")',
  )
  .option(
    "-p, --path <path>",
    'Target file path to evaluate (e.g. ".env", "src/index.ts")',
  )
  .option("-w, --workspace <path>", "Workspace root path", process.cwd())
  .option("--config <path>", "Custom agent-monitor.config.json path")
  .action(async (options) => {
    try {
      await runPolicyCheckCommand({
        action: options.action,
        command: options.command,
        path: options.path,
        workspace: options.workspace,
        config: options.config,
      });
    } catch (err: any) {
      console.error(`\n❌ Error: ${err.message}`);
      process.exit(1);
    }
  });

// Direct alias: `agent-monitor check ...`
program
  .command("check")
  .description("Alias for policy check (Dry Run simulation)")
  .option("-a, --action <action>", "Action kind", "process.exec")
  .option("-c, --command <command>", "Target command")
  .option("-p, --path <path>", "Target file path")
  .option("-w, --workspace <path>", "Workspace root", process.cwd())
  .option("--config <path>", "Custom agent-monitor.config.json path")
  .action(async (options) => {
    try {
      await runPolicyCheckCommand(options);
    } catch (err: any) {
      console.error(`\n❌ Error: ${err.message}`);
      process.exit(1);
    }
  });

// 4. Configuration Commands (`agent-monitor config init` / `validate`)
const configCmd = program
  .command("config")
  .description("Manage and bootstrap Agent Monitor configuration files");

configCmd
  .command("init")
  .description(
    "Generate a starter agent-monitor.config.json file in the current directory",
  )
  .option("-w, --workspace <path>", "Target workspace directory", process.cwd())
  .option("-f, --force", "Overwrite existing configuration file if present")
  .action(async (options) => {
    try {
      await runConfigInitCommand(options);
    } catch (err: any) {
      console.error(`\n❌ Error: ${err.message}`);
      process.exit(1);
    }
  });

configCmd
  .command("validate [path]")
  .description(
    "Validate syntax and policy rules of an agent-monitor.config.json file",
  )
  .option("-w, --workspace <path>", "Target workspace directory", process.cwd())
  .action(async (configPath, options) => {
    try {
      await runConfigValidateCommand(configPath, options);
    } catch (err: any) {
      console.error(`\n❌ Error: ${err.message}`);
      process.exit(1);
    }
  });

// 5. Session History Command (`agent-monitor sessions`)
program
  .command("sessions")
  .description("List recorded agent sessions from SQLite storage")
  .option("-w, --workspace <path>", "Workspace directory", process.cwd())
  .option("--db <path>", "Custom SQLite database file path")
  .option(
    "-n, --limit <count>",
    "Number of sessions to show",
    (val) => parseInt(val, 10),
    20,
  )
  .action(async (options) => {
    try {
      await runSessionsCommand(options);
    } catch (err: any) {
      console.error(`\n❌ Error: ${err.message}`);
      process.exit(1);
    }
  });

// 6. System Status Command (`agent-monitor status`)
program
  .command("status")
  .description(
    "Show system status, SQLite storage size, and active configuration",
  )
  .option("-w, --workspace <path>", "Workspace directory", process.cwd())
  .option(
    "-p, --port <port>",
    "Monitor Server port to probe",
    (val) => parseInt(val, 10),
    4040,
  )
  .option("--db <path>", "Custom SQLite database file path")
  .action(async (options) => {
    try {
      await runStatusCommand(options);
    } catch (err: any) {
      console.error(`\n❌ Error: ${err.message}`);
      process.exit(1);
    }
  });

// 7. MCP Transparent Proxy Command (`agent-monitor mcp proxy -- <command>`)
const mcpCmd = program
  .command("mcp")
  .description(
    "Transparent Model Context Protocol (MCP) gateway & security controls",
  );

mcpCmd
  .command("proxy")
  .description(
    "Wrap an external MCP server process over stdio with deterministic policy enforcement and tool fingerprinting",
  )
  .argument(
    "<command...>",
    "Downstream command to execute (e.g. npx -y @modelcontextprotocol/server-filesystem /tmp)",
  )
  .option("-w, --workspace <path>", "Workspace directory", process.cwd())
  .option("-s, --session <id>", "Session ID to associate or resume")
  .option(
    "--server-name <name>",
    "Descriptive name for the downstream MCP server",
  )
  .option(
    "-p, --port <port>",
    "Monitor Server port",
    (val) => parseInt(val, 10),
    4040,
  )
  .option("--db <path>", "Custom SQLite database file path")
  .option("-c, --config <path>", "Path to agent-monitor.config.json")
  .option(
    "--no-server",
    "Disable background HTTP/SSE server for this proxy session",
  )
  .action(async (command, options) => {
    try {
      await runMcpProxyCommand({
        command,
        workspace: options.workspace,
        session: options.session,
        serverName: options.serverName,
        port: options.port,
        db: options.db,
        config: options.config,
        server: options.server,
      });
    } catch (err: any) {
      process.stderr.write(`\n❌ MCP Proxy Error: ${err.message}\n`);
      process.exit(1);
    }
  });

// 8. Kill Switch Commands (`agent-monitor kill` / `resume`)
program
  .command("kill")
  .description(
    "Activate the authoritative local circuit breaker / kill switch for an agent session",
  )
  .option(
    "-s, --session <id>",
    "Target session ID (defaults to active session)",
  )
  .option(
    "-r, --reason <reason>",
    "Reason for killing the session",
    "Operator activated kill switch via CLI",
  )
  .option("-w, --workspace <path>", "Workspace directory", process.cwd())
  .option("--db <path>", "Custom SQLite database file path")
  .option(
    "-p, --port <port>",
    "Monitor Server port to notify",
    (val) => parseInt(val, 10),
    4040,
  )
  .action(async (options) => {
    try {
      await runKillCommand(options);
    } catch (err: any) {
      console.error(`\n❌ Error: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command("resume")
  .description(
    "Deactivate the kill switch and resume execution for an agent session",
  )
  .option(
    "-s, --session <id>",
    "Target session ID (defaults to active session)",
  )
  .option("-w, --workspace <path>", "Workspace directory", process.cwd())
  .option("--db <path>", "Custom SQLite database file path")
  .option(
    "-p, --port <port>",
    "Monitor Server port to notify",
    (val) => parseInt(val, 10),
    4040,
  )
  .action(async (options) => {
    try {
      await runResumeCommand(options);
    } catch (err: any) {
      console.error(`\n❌ Error: ${err.message}`);
      process.exit(1);
    }
  });

// 9. External Tool Inspection (`agent-monitor tools`)
program
  .command("tools")
  .description(
    "Inspect external tool fingerprints, baseline integrity, and mutation status (rug-pull detection)",
  )
  .option("-s, --session <id>", "Target session ID")
  .option("-w, --workspace <path>", "Workspace directory", process.cwd())
  .option("--db <path>", "Custom SQLite database file path")
  .option(
    "-p, --port <port>",
    "Monitor Server port to query",
    (val) => parseInt(val, 10),
    4040,
  )
  .action(async (options) => {
    try {
      await runToolsCommand(options);
    } catch (err: any) {
      console.error(`\n❌ Error: ${err.message}`);
      process.exit(1);
    }
  });

// 10. Behavioral Data Flow Inspection (`agent-monitor security flows`)
const secCmd = program
  .command("security")
  .description(
    "Inspect security data flows and behavioral sequence violations",
  );

secCmd
  .command("flows")
  .description(
    "Inspect detected behavioral data-flow sequences and multi-step exfiltration attempts",
  )
  .option("-s, --session <id>", "Target session ID")
  .option("-w, --workspace <path>", "Workspace directory", process.cwd())
  .option("--db <path>", "Custom SQLite database file path")
  .option(
    "-p, --port <port>",
    "Monitor Server port to query",
    (val) => parseInt(val, 10),
    4040,
  )
  .action(async (options) => {
    try {
      await runSecurityFlowsCommand(options);
    } catch (err: any) {
      console.error(`\n❌ Error: ${err.message}`);
      process.exit(1);
    }
  });

program.parse(process.argv);

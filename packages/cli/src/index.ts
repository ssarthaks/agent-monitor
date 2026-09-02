#!/usr/bin/env node
import { Command } from 'commander';
import { runAgentCommand } from './commands/run.js';
import { runServerCommand } from './commands/server.js';
import { runPolicyCheckCommand } from './commands/check.js';

const program = new Command();

program
  .name('agent-monitor')
  .description('Agent Monitor — Activity Monitor & Deterministic Policy Gate for AI Agents')
  .version('0.2.0');

// 1. Run Agent Task with Policy Monitoring
program
  .command('run')
  .description('Run an autonomous coding agent with real-time activity monitoring, policy enforcement, and human approvals')
  .requiredOption('-t, --task <task>', 'The task or prompt for the agent to execute')
  .option('-w, --workspace <path>', 'Workspace directory path (defaults to current working directory)')
  .option('-p, --port <port>', 'Monitor Server API port', (val) => parseInt(val, 10), 4040)
  .option('--web-port <port>', 'Dashboard web port', (val) => parseInt(val, 10), 3000)
  .option('--model <model>', 'DeepSeek model name', 'deepseek-chat')
  .option('--db <path>', 'Custom SQLite database file path')
  .option('-c, --config <path>', 'Path to agent-monitor.config.json')
  .option('--keep-alive', 'Keep the monitor server running after the agent task finishes')
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

// 2. Standalone Background Server
program
  .command('server')
  .description('Start the standalone Monitor Server to serve SQLite session history, embedded DevTools UI, and live SSE')
  .option('-p, --port <port>', 'Monitor Server API port', (val) => parseInt(val, 10), 4040)
  .option('-w, --workspace <path>', 'Workspace directory path', process.cwd())
  .option('--db <path>', 'Custom SQLite database file path')
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

// 3. Policy Dry-Run Simulator
const policyCmd = program
  .command('policy')
  .description('Inspect and simulate deterministic security policies');

policyCmd
  .command('check')
  .description('Simulate policy evaluation on a target action/command without executing it (Dry Run)')
  .option('-a, --action <action>', 'Action kind (e.g. process.exec, file.read, file.write)', 'process.exec')
  .option('-c, --command <command>', 'Target command to evaluate (e.g. "git push origin main", "npm test")')
  .option('-p, --path <path>', 'Target file path to evaluate (e.g. ".env", "src/index.ts")')
  .option('-w, --workspace <path>', 'Workspace root path', process.cwd())
  .option('--config <path>', 'Custom agent-monitor.config.json path')
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
  .command('check')
  .description('Alias for policy check (Dry Run simulation)')
  .option('-a, --action <action>', 'Action kind', 'process.exec')
  .option('-c, --command <command>', 'Target command')
  .option('-p, --path <path>', 'Target file path')
  .option('-w, --workspace <path>', 'Workspace root', process.cwd())
  .option('--config <path>', 'Custom agent-monitor.config.json path')
  .action(async (options) => {
    try {
      await runPolicyCheckCommand(options);
    } catch (err: any) {
      console.error(`\n❌ Error: ${err.message}`);
      process.exit(1);
    }
  });

program.parse(process.argv);

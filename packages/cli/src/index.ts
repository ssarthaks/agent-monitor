#!/usr/bin/env node
import { Command } from 'commander';
import { runAgentCommand } from './commands/run.js';
import { runServerCommand } from './commands/server.js';

const program = new Command();

program
  .name('agent-monitor')
  .description('Agent Monitor — Activity Monitor & Control Plane for AI Agents')
  .version('0.1.0');

program
  .command('run')
  .description('Run an autonomous coding agent with real-time activity monitoring and guardrails')
  .requiredOption('-t, --task <task>', 'The task or prompt for the agent to execute')
  .option('-w, --workspace <path>', 'Workspace directory path (defaults to current working directory)')
  .option('-p, --port <port>', 'Monitor Server API port', (val) => parseInt(val, 10), 4040)
  .option('--web-port <port>', 'Dashboard web port', (val) => parseInt(val, 10), 3000)
  .option('--model <model>', 'DeepSeek model name', 'deepseek-chat')
  .option('--db <path>', 'Custom SQLite database file path')
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
        keepAlive: options.keepAlive,
      });
    } catch (err: any) {
      console.error(`\n❌ Error: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('server')
  .description('Start the standalone Monitor Server to serve SQLite session history and live SSE')
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

program.parse(process.argv);

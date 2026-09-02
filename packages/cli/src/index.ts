#!/usr/bin/env node
import { Command } from 'commander';
import { runAgentCommand } from './commands/run.js';

const program = new Command();

program
  .name('agent-monitor')
  .description('Agent Monitor — Chrome DevTools & Activity Monitor for AI Agents')
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
  .action(async (options) => {
    try {
      await runAgentCommand({
        task: options.task,
        workspace: options.workspace,
        port: options.port,
        webPort: options.webPort,
        model: options.model,
        db: options.db,
      });
    } catch (err: any) {
      console.error(`\n❌ Error: ${err.message}`);
      process.exit(1);
    }
  });

program.parse(process.argv);

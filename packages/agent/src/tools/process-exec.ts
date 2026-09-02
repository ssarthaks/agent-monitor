import { spawn } from 'node:child_process';
import { ProcessExecParams, ProcessExecResult } from '@agent-monitor/core';
import { ToolDefinition } from '../runtime.js';
import {
  resolveSafeWorkspacePath,
  DEFAULT_COMMAND_TIMEOUT_MS,
  MAX_COMMAND_OUTPUT_BYTES,
  truncateOutput,
} from './guardrails.js';

export const runCommandTool: ToolDefinition<ProcessExecParams, ProcessExecResult> = {
  name: 'run_command',
  actionKind: 'process.exec',
  category: 'process',
  description: 'Execute a shell command within the workspace directory with timeout and bounded buffer.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command line to execute',
      },
      cwd: {
        type: 'string',
        description: 'Optional working subdirectory within workspace',
      },
      timeoutMs: {
        type: 'integer',
        description: 'Command timeout in milliseconds (defaults to 30000)',
      },
    },
    required: ['command'],
  },
  execute: async (params, ctx) => {
    let targetCwd = ctx.workspaceRoot;
    if (params.cwd) {
      const { safePath, isOutsideWorkspace, reason } = resolveSafeWorkspacePath(
        params.cwd,
        ctx.workspaceRoot
      );
      if (isOutsideWorkspace) {
        throw new Error(`Security Violation: Cwd ${reason}`);
      }
      targetCwd = safePath;
    }

    const timeoutMs = params.timeoutMs || DEFAULT_COMMAND_TIMEOUT_MS;
    const startTime = Date.now();

    return new Promise<ProcessExecResult>((resolve) => {
      let stdoutBuffer = '';
      let stderrBuffer = '';
      let timedOut = false;

      const isWin = process.platform === 'win32';
      const shell = isWin ? 'cmd.exe' : '/bin/sh';
      const shellArgs = isWin ? ['/d', '/s', '/c', params.command] : ['-c', params.command];

      const child = spawn(shell, shellArgs, {
        cwd: targetCwd,
        env: {
          ...process.env,
          PAGER: 'cat',
        },
      });

      const timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill('SIGTERM');
          setTimeout(() => {
            if (!child.killed) {
              child.kill('SIGKILL');
            }
          }, 1000);
        } catch {
          // ignore
        }
      }, timeoutMs);

      child.stdout.on('data', (data) => {
        if (Buffer.byteLength(stdoutBuffer, 'utf8') < MAX_COMMAND_OUTPUT_BYTES * 2) {
          stdoutBuffer += data.toString('utf8');
        }
      });

      child.stderr.on('data', (data) => {
        if (Buffer.byteLength(stderrBuffer, 'utf8') < MAX_COMMAND_OUTPUT_BYTES * 2) {
          stderrBuffer += data.toString('utf8');
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;
        resolve({
          command: params.command,
          stdout: truncateOutput(stdoutBuffer),
          stderr: truncateOutput(`Process spawn error: ${err.message}\n${stderrBuffer}`),
          exitCode: 1,
          durationMs,
          timedOut,
        });
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;

        if (timedOut) {
          stderrBuffer += `\n[Command timed out after ${timeoutMs}ms]`;
        }

        resolve({
          command: params.command,
          stdout: truncateOutput(stdoutBuffer),
          stderr: truncateOutput(stderrBuffer),
          exitCode: timedOut ? 124 : code,
          durationMs,
          timedOut,
        });
      });
    });
  },
};

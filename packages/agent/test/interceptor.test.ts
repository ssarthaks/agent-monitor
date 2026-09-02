import { describe, it, expect, beforeEach } from 'vitest';
import { ActionInterceptor } from '../src/interceptor.js';
import { readFileTool } from '../src/tools/file-read.js';
import { writeFileTool } from '../src/tools/file-write.js';
import { runCommandTool } from '../src/tools/process-exec.js';
import {
  AgentEvent,
  ActionStartedEvent,
  ActionCompletedEvent,
  ActionBlockedEvent,
  PolicyEvaluatedEvent,
} from '@agent-monitor/core';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('ActionInterceptor', () => {
  let emittedEvents: AgentEvent[];
  let interceptor: ActionInterceptor;
  let tmpDir: string;
  let ctx: any;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'interceptor-test-'));
    emittedEvents = [];
    interceptor = new ActionInterceptor({
      emit: async (ev) => {
        emittedEvents.push(ev);
      },
    });

    interceptor.registerTool(readFileTool);
    interceptor.registerTool(writeFileTool);
    interceptor.registerTool(runCommandTool);

    ctx = {
      sessionId: 'ses_interceptor_1',
      agentId: 'test-agent',
      workspaceRoot: tmpDir,
    };
  });

  it('intercepts tool execution and emits correlated policy, started, and completed events', async () => {
    await interceptor.invoke('write_file', { path: 'hello.txt', content: 'World' }, ctx);

    expect(emittedEvents.length).toBe(3);
    const policyEv = emittedEvents[0] as PolicyEvaluatedEvent;
    const started = emittedEvents[1] as ActionStartedEvent;
    const completed = emittedEvents[2] as ActionCompletedEvent;

    expect(policyEv.type).toBe('policy.evaluated');
    expect(policyEv.decision).toBe('ALLOW');

    expect(started.type).toBe('action.started');
    expect(started.kind).toBe('file.write');
    expect(started.actionId).toBe(policyEv.actionId);

    expect(completed.type).toBe('action.completed');
    expect(completed.actionId).toBe(started.actionId);
    expect(completed.metadata?.diff).toBeDefined();
  });

  it('detects high risk on .env file and blocks by security policy', async () => {
    await expect(
      interceptor.invoke('write_file', { path: '.env', content: 'SECRET=123' }, ctx)
    ).rejects.toThrow(/Security Violation.*blocked by policy/);

    expect(emittedEvents.length).toBe(2); // policy.evaluated + action.blocked
    const blocked = emittedEvents[1] as ActionBlockedEvent;
    expect(blocked.type).toBe('action.blocked');
    expect(blocked.risk.level).toBe('HIGH');
    expect(blocked.risk.flags.some((f) => f.ruleId === 'SEC_DOTENV')).toBe(true);
    expect(blocked.policy?.decision).toBe('DENY');
  });

  it('emits action.blocked on path traversal outside workspace', async () => {
    await expect(
      interceptor.invoke('read_file', { path: '../../outside.txt' }, ctx)
    ).rejects.toThrow(/Security Violation/);

    expect(emittedEvents.length).toBe(2); // policy.evaluated + action.blocked
    const blocked = emittedEvents[1] as ActionBlockedEvent;
    expect(blocked.type).toBe('action.blocked');
    expect(blocked.risk.level).toBe('HIGH');
    expect(blocked.reason).toContain('outside the designated workspace root');
  });

  it('supports parallel tool execution with distinct actionIds', async () => {
    await Promise.all([
      interceptor.invoke('write_file', { path: 'file1.txt', content: '1' }, ctx),
      interceptor.invoke('write_file', { path: 'file2.txt', content: '2' }, ctx),
    ]);

    expect(emittedEvents.length).toBe(6); // (policy.evaluated + action.started + action.completed) * 2
    const policies = emittedEvents.filter((e) => e.type === 'policy.evaluated') as PolicyEvaluatedEvent[];
    const starts = emittedEvents.filter((e) => e.type === 'action.started') as ActionStartedEvent[];
    const completions = emittedEvents.filter((e) => e.type === 'action.completed') as ActionCompletedEvent[];

    expect(policies.length).toBe(2);
    expect(starts.length).toBe(2);
    expect(completions.length).toBe(2);
    expect(starts[0].actionId).not.toBe(starts[1].actionId);

    for (const start of starts) {
      const match = completions.find((c) => c.actionId === start.actionId);
      expect(match).toBeDefined();
    }
  });
});

import { describe, it, expect, vi } from 'vitest';
import {
  ActionInterceptor,
  EventSink,
  ApprovalManager,
} from '../src/index.js';
import {
  PolicyEngine,
  AgentEvent,
  PolicyDecision,
} from '@agent-monitor/core';

describe('ActionInterceptor with Policy Enforcement (Phase C)', () => {
  const createContext = (sessionId = 'ses_01') => ({
    sessionId,
    agentId: 'deepseek-coding-agent',
    workspaceRoot: '/app',
  });

  it('ALLOW: emits policy.evaluated -> action.started -> tool.execute -> action.completed', async () => {
    const emittedEvents: AgentEvent[] = [];
    const sink: EventSink = { emit: async (e) => { emittedEvents.push(e); } };

    const policyEngine = new PolicyEngine({
      rules: [{ id: 'allow-read', action: 'file.read', decision: 'ALLOW' }],
    });

    const interceptor = new ActionInterceptor({ sink, policyEngine });

    let toolExecutedCount = 0;
    interceptor.registerTool({
      name: 'read_file',
      actionKind: 'file.read',
      category: 'file',
      description: 'Read file',
      parameters: { type: 'object', properties: { path: { type: 'string' } } },
      execute: async () => {
        toolExecutedCount++;
        return { content: 'hello world', bytesRead: 11 };
      },
    });

    const res = await interceptor.invoke('read_file', { path: 'src/App.tsx' }, createContext());
    expect(res.content).toBe('hello world');
    expect(toolExecutedCount).toBe(1);

    const eventTypes = emittedEvents.map((e) => e.type);
    expect(eventTypes).toEqual(['policy.evaluated', 'action.started', 'action.completed']);
  });

  it('DENY: emits policy.evaluated -> action.blocked and tool is NEVER executed', async () => {
    const emittedEvents: AgentEvent[] = [];
    const sink: EventSink = { emit: async (e) => { emittedEvents.push(e); } };

    const policyEngine = new PolicyEngine({
      rules: [{ id: 'deny-env', action: 'file.read', path: '.env', decision: 'DENY' }],
    });

    const interceptor = new ActionInterceptor({ sink, policyEngine });

    let toolExecutedCount = 0;
    interceptor.registerTool({
      name: 'read_file',
      actionKind: 'file.read',
      category: 'file',
      description: 'Read file',
      parameters: { type: 'object', properties: { path: { type: 'string' } } },
      execute: async () => {
        toolExecutedCount++;
        return { content: 'SECRET_KEY=123' };
      },
    });

    await expect(
      interceptor.invoke('read_file', { path: '.env' }, createContext())
    ).rejects.toThrow(/Security Violation.*blocked by policy/);

    expect(toolExecutedCount).toBe(0); // STRICTLY ZERO

    const eventTypes = emittedEvents.map((e) => e.type);
    expect(eventTypes).toEqual(['policy.evaluated', 'action.blocked']);
    expect(eventTypes).not.toContain('action.started');
  });

  it('ASK (Approved): pauses, waits for approval, then executes tool exactly once', async () => {
    const emittedEvents: AgentEvent[] = [];
    const sink: EventSink = { emit: async (e) => { emittedEvents.push(e); } };

    const policyEngine = new PolicyEngine({
      rules: [{ id: 'ask-git-push', action: 'process.exec', command: 'git push *', decision: 'ASK' }],
    });

    const approvalManager = new ApprovalManager({
      onApprovalResolved: async (app, decision, resolvedBy) => {
        await sink.emit({
          id: 'evt_res_app',
          sequence: 0,
          sessionId: app.sessionId,
          agentId: 'deepseek-coding-agent',
          timestamp: Date.now(),
          type: 'approval.resolved',
          approvalId: app.id,
          actionId: app.actionId,
          decision,
          resolvedBy,
        });
      },
    });

    const interceptor = new ActionInterceptor({ sink, policyEngine, approvalManager });

    let toolExecutedCount = 0;
    interceptor.registerTool({
      name: 'run_command',
      actionKind: 'process.exec',
      category: 'process',
      description: 'Run command',
      parameters: { type: 'object', properties: { command: { type: 'string' } } },
      execute: async () => {
        toolExecutedCount++;
        return { stdout: 'Everything up-to-date', exitCode: 0 };
      },
    });

    // Simulate human approval arriving asynchronously after 50ms
    setTimeout(() => {
      const requestedEv = emittedEvents.find((e) => e.type === 'approval.requested') as any;
      if (requestedEv) {
        approvalManager.resolve(requestedEv.approvalId, 'approved', 'user_browser');
      }
    }, 50);

    const res = await interceptor.invoke(
      'run_command',
      { command: 'git push origin main' },
      createContext()
    );

    expect(res.exitCode).toBe(0);
    expect(toolExecutedCount).toBe(1);

    const eventTypes = emittedEvents.map((e) => e.type);
    expect(eventTypes).toEqual([
      'policy.evaluated',
      'approval.requested',
      'approval.resolved',
      'action.started',
      'action.completed',
    ]);

    // Verify EXACTLY ONE approval.resolved event
    const resolvedEvents = emittedEvents.filter((e) => e.type === 'approval.resolved');
    expect(resolvedEvents.length).toBe(1);
  });

  it('ASK (Denied): pauses, receives denial, emits action.blocked, and tool NEVER executes', async () => {
    const emittedEvents: AgentEvent[] = [];
    const sink: EventSink = { emit: async (e) => { emittedEvents.push(e); } };

    const policyEngine = new PolicyEngine({
      rules: [{ id: 'ask-git-push', action: 'process.exec', command: 'git push *', decision: 'ASK' }],
    });

    const approvalManager = new ApprovalManager({
      onApprovalResolved: async (app, decision, resolvedBy) => {
        await sink.emit({
          id: 'evt_res_deny',
          sequence: 0,
          sessionId: app.sessionId,
          agentId: 'deepseek-coding-agent',
          timestamp: Date.now(),
          type: 'approval.resolved',
          approvalId: app.id,
          actionId: app.actionId,
          decision,
          resolvedBy,
        });
      },
    });

    const interceptor = new ActionInterceptor({ sink, policyEngine, approvalManager });

    let toolExecutedCount = 0;
    interceptor.registerTool({
      name: 'run_command',
      actionKind: 'process.exec',
      category: 'process',
      description: 'Run command',
      parameters: { type: 'object', properties: { command: { type: 'string' } } },
      execute: async () => {
        toolExecutedCount++;
        return { stdout: 'Deployed' };
      },
    });

    // Simulate human denial arriving asynchronously
    setTimeout(() => {
      const requestedEv = emittedEvents.find((e) => e.type === 'approval.requested') as any;
      if (requestedEv) {
        approvalManager.resolve(requestedEv.approvalId, 'denied', 'user_cli');
      }
    }, 50);

    await expect(
      interceptor.invoke('run_command', { command: 'git push origin main' }, createContext())
    ).rejects.toThrow(/Policy Error.*denied by user/);

    expect(toolExecutedCount).toBe(0); // STRICTLY ZERO

    const eventTypes = emittedEvents.map((e) => e.type);
    expect(eventTypes).toEqual([
      'policy.evaluated',
      'approval.requested',
      'approval.resolved',
      'action.blocked',
    ]);
    expect(eventTypes).not.toContain('action.started');

    // Verify EXACTLY ONE approval.resolved event
    const resolvedEvents = emittedEvents.filter((e) => e.type === 'approval.resolved');
    expect(resolvedEvents.length).toBe(1);
  });

  it('ASK (Timeout): expires after timeoutMs and tool is blocked without executing', async () => {
    const emittedEvents: AgentEvent[] = [];
    const sink: EventSink = { emit: async (e) => { emittedEvents.push(e); } };

    const policyEngine = new PolicyEngine({
      rules: [{ id: 'ask-install', action: 'process.exec', command: 'npm install *', decision: 'ASK' }],
      approval: { timeoutMs: 100 }, // 100ms test timeout
    });

    const approvalManager = new ApprovalManager({
      timeoutMs: 100,
      onApprovalResolved: async (app, decision, resolvedBy) => {
        await sink.emit({
          id: 'evt_res_expire',
          sequence: 0,
          sessionId: app.sessionId,
          agentId: 'deepseek-coding-agent',
          timestamp: Date.now(),
          type: 'approval.resolved',
          approvalId: app.id,
          actionId: app.actionId,
          decision,
          resolvedBy,
        });
      },
    });

    const interceptor = new ActionInterceptor({ sink, policyEngine, approvalManager });

    let toolExecutedCount = 0;
    interceptor.registerTool({
      name: 'run_command',
      actionKind: 'process.exec',
      category: 'process',
      description: 'Run command',
      parameters: { type: 'object', properties: { command: { type: 'string' } } },
      execute: async () => {
        toolExecutedCount++;
        return { stdout: 'installed' };
      },
    });

    // Do NOT resolve -> wait for timeout
    await expect(
      interceptor.invoke('run_command', { command: 'npm install lodash' }, createContext())
    ).rejects.toThrow(/Policy Error.*timed out/);

    expect(toolExecutedCount).toBe(0);

    const eventTypes = emittedEvents.map((e) => e.type);
    expect(eventTypes).toEqual([
      'policy.evaluated',
      'approval.requested',
      'approval.resolved',
      'action.blocked',
    ]);
    expect(eventTypes).not.toContain('action.started');

    // Verify EXACTLY ONE approval.resolved event
    const resolvedEvents = emittedEvents.filter((e) => e.type === 'approval.resolved');
    expect(resolvedEvents.length).toBe(1);
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase } from '../src/db/database.js';
import { SessionRepository } from '../src/db/repository.js';
import { EventBus } from '../src/bus.js';
import { MonitorServer } from '../src/app.js';
import { AgentSession, ActionStartedEvent, ActionCompletedEvent } from '@agent-monitor/core';

describe('Server & SQLite persistence', () => {
  let db: any;
  let repo: SessionRepository;
  let bus: EventBus;
  let server: MonitorServer;
  let serverUrl: string;

  beforeEach(async () => {
    db = createDatabase(':memory:');
    repo = new SessionRepository(db);
    bus = new EventBus();
    server = new MonitorServer({ repository: repo, eventBus: bus, port: 0 });
    const { port } = await server.start();
    serverUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await server.stop();
    db.close();
  });

  it('creates and persists session in SQLite', () => {
    const session: AgentSession = {
      id: 'ses_test_1',
      agentId: 'deepseek-coder',
      agentName: 'DeepSeek Test Agent',
      provider: 'deepseek',
      model: 'deepseek-coder',
      workspaceRoot: '/test/workspace',
      task: 'Run tests and fix errors',
      startedAt: Date.now(),
      status: 'running',
      riskScore: 0,
    };

    repo.createSession(session);
    const retrieved = repo.getSession('ses_test_1');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.agentId).toBe('deepseek-coder');
    expect(retrieved?.status).toBe('running');
  });

  it('persists events to SQLite and retrieves them in sequence order', () => {
    const session: AgentSession = {
      id: 'ses_test_2',
      agentId: 'deepseek-coder',
      agentName: 'DeepSeek Test Agent',
      provider: 'deepseek',
      model: 'deepseek-coder',
      workspaceRoot: '/test/workspace',
      task: 'Test task',
      startedAt: Date.now(),
      status: 'running',
      riskScore: 0,
    };
    repo.createSession(session);

    const event1: ActionStartedEvent = {
      id: 'evt_1',
      sequence: 1,
      sessionId: 'ses_test_2',
      agentId: 'deepseek-coder',
      timestamp: Date.now(),
      type: 'action.started',
      actionId: 'act_1',
      kind: 'file.read',
      category: 'file',
      params: { path: 'package.json' },
      risk: { score: 0, level: 'NONE', flags: [] },
    };

    const event2: ActionCompletedEvent = {
      id: 'evt_2',
      sequence: 2,
      sessionId: 'ses_test_2',
      agentId: 'deepseek-coder',
      timestamp: Date.now() + 10,
      type: 'action.completed',
      actionId: 'act_1',
      kind: 'file.read',
      category: 'file',
      params: { path: 'package.json' },
      result: { content: '{}' },
      durationMs: 10,
      risk: { score: 0, level: 'NONE', flags: [] },
    };

    repo.insertEvent(event1);
    repo.insertEvent(event2);

    const events = repo.getEventsBySession('ses_test_2');
    expect(events.length).toBe(2);
    expect(events[0].id).toBe('evt_1');
    expect(events[1].id).toBe('evt_2');
  });

  it('serves HTTP API and reconstructs session events', async () => {
    const resCreate = await fetch(`${serverUrl}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'ses_http_1',
        agentId: 'deepseek-coder',
        agentName: 'DeepSeek Agent',
        provider: 'deepseek',
        model: 'deepseek-coder',
        workspaceRoot: '/tmp',
        task: 'HTTP test',
      }),
    });
    expect(resCreate.status).toBe(201);

    const resEvent = await fetch(`${serverUrl}/sessions/ses_http_1/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'evt_http_1',
        sessionId: 'ses_http_1',
        agentId: 'deepseek-coder',
        timestamp: Date.now(),
        type: 'action.started',
        actionId: 'act_http_1',
        kind: 'process.exec',
        category: 'process',
        params: { command: 'rm -rf /' },
        risk: { score: 60, level: 'CRITICAL', flags: [] },
      }),
    });
    expect(resEvent.status).toBe(201);

    const resSession = await fetch(`${serverUrl}/sessions/ses_http_1`);
    const sessionData = await resSession.json();
    expect(sessionData.session.riskScore).toBe(60);

    const resEvents = await fetch(`${serverUrl}/sessions/ses_http_1/events`);
    const eventsData = await resEvents.json();
    expect(eventsData.events.length).toBe(1);
    expect(eventsData.events[0].actionId).toBe('act_http_1');
  });
});

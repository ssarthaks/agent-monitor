import path from 'node:path';
import fs from 'node:fs';
import {
  AgentEvent,
  AgentSession,
  SessionEndedEvent,
  RiskAnalyzer,
} from '@agent-monitor/core';
import {
  createDatabase,
  SessionRepository,
  EventBus,
  MonitorServer,
} from '@agent-monitor/server';
import {
  ActionInterceptor,
  DeepSeekCodingAgent,
  DeepSeekClient,
  readFileTool,
  writeFileTool,
  listFilesTool,
  runCommandTool,
} from '@agent-monitor/agent';
import {
  printStartupBanner,
  printLiveEvent,
  printSummaryBanner,
} from '../banner.js';

export interface RunCommandOptions {
  task: string;
  workspace?: string;
  port?: number;
  webPort?: number;
  db?: string;
  model?: string;
  apiKey?: string;
}

function loadEnvFiles(workspaceRoot: string) {
  const envCandidates = [
    path.join(process.cwd(), '.env.local'),
    path.join(process.cwd(), '.env'),
    path.join(workspaceRoot, '.env.local'),
    path.join(workspaceRoot, '.env'),
  ];

  for (const file of envCandidates) {
    if (fs.existsSync(file)) {
      try {
        const content = fs.readFileSync(file, 'utf8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
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

export async function runAgentCommand(options: RunCommandOptions): Promise<void> {
  const workspaceRoot = path.resolve(options.workspace || process.cwd());
  loadEnvFiles(workspaceRoot);

  const dbDir = path.join(workspaceRoot, '.agent-monitor');
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const dbPath = options.db ? path.resolve(options.db) : path.join(dbDir, 'data.db');
  const serverPort = options.port || Number(process.env.AGENT_MONITOR_PORT) || 4040;
  const webPort = options.webPort || Number(process.env.PORT) || 3000;
  const model = options.model || process.env.DEEPSEEK_MODEL || 'deepseek-chat';
  const apiKey = options.apiKey || process.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    console.error('\n❌ ERROR: DEEPSEEK_API_KEY is required to run the agent.');
    console.error('Please add DEEPSEEK_API_KEY to your .env or .env.local file, or export it in your shell.\n');
    process.exit(1);
  }

  // 1. Initialize SQLite Database & Repositories
  const db = createDatabase(dbPath);
  const repository = new SessionRepository(db);
  const eventBus = new EventBus();

  // 2. Start Monitor Server
  const server = new MonitorServer({
    port: serverPort,
    repository,
    eventBus,
  });
  const { port: actualPort } = await server.start();
  const serverUrl = `http://127.0.0.1:${actualPort}`;
  const dashboardUrl = `http://localhost:${webPort}?sessionId=`;

  const sessionId = `ses_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
  const agentId = 'deepseek-coding-agent';
  const agentName = 'DeepSeek Coding Agent';
  const startTime = Date.now();

  const session: AgentSession = {
    id: sessionId,
    agentId,
    agentName,
    provider: 'deepseek',
    model,
    workspaceRoot,
    task: options.task,
    startedAt: startTime,
    status: 'running',
    riskScore: 0,
  };

  repository.createSession(session);

  // 3. Connect Terminal Logger to EventBus
  eventBus.subscribe(sessionId, (event) => {
    printLiveEvent(event);
  });

  // 4. Setup Action Interceptor
  const interceptor = new ActionInterceptor(
    {
      emit: async (event: AgentEvent) => {
        if (!event.sequence) {
          (event as any).sequence = repository.getNextSequence(sessionId);
        }
        repository.insertEvent(event);
        eventBus.publish(event);
      },
    },
    new RiskAnalyzer()
  );

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
    provider: 'deepseek',
    model,
    workspaceRoot,
    task: options.task,
    timestamp: startTime,
  });

  printStartupBanner(session, serverUrl, `${dashboardUrl}${sessionId}`);

  // 5. Initialize and Run DeepSeek Agent
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

  let sessionStatus: AgentSession['status'] = 'completed';

  try {
    await agent.run(options.task);
  } catch (err: any) {
    sessionStatus = 'failed';
    console.error(`\n❌ Agent encountered an error: ${err.message}`);
  }

  // 6. Compute Session Summary
  const allEvents = repository.getEventsBySession(sessionId);
  const durationMs = Date.now() - startTime;

  let filesRead = 0;
  let filesWritten = 0;
  let commandsRun = 0;
  let errorsCount = 0;
  let overallRiskScore = 0;

  for (const ev of allEvents) {
    if (ev.type === 'action.started' || ev.type === 'action.completed') {
      if (ev.risk && ev.risk.score > overallRiskScore) {
        overallRiskScore = ev.risk.score;
      }
    }
    if (ev.type === 'action.completed') {
      if (ev.kind === 'file.read') filesRead++;
      if (ev.kind === 'file.write') filesWritten++;
      if (ev.kind === 'process.exec') commandsRun++;
    }
    if (ev.type === 'action.failed' || ev.type === 'action.blocked') {
      errorsCount++;
    }
  }

  const summary: SessionEndedEvent['summary'] = {
    totalActions: filesRead + filesWritten + commandsRun,
    filesRead,
    filesWritten,
    commandsRun,
    errorsCount,
    overallRiskScore,
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

  await server.stop();
  db.close();
}

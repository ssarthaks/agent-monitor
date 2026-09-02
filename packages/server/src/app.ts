import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { URL } from 'node:url';
import { AgentEvent, AgentSession, ApprovalRequest, PolicyEngine } from '@agent-monitor/core';
import { SessionRepository } from './db/repository.js';
import { EventBus } from './bus.js';

export interface ServerOptions {
  port?: number;
  host?: string;
  repository: SessionRepository;
  eventBus: EventBus;
  policyEngine?: PolicyEngine;
  publicDir?: string;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function findPublicDir(customDir?: string): string | null {
  if (customDir && fs.existsSync(customDir)) {
    return customDir;
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const candidates = [
    path.join(__dirname, '../public'),
    path.join(__dirname, 'public'),
    path.join(__dirname, '../../public'),
    path.join(__dirname, '../../../apps/web/out'),
    path.join(process.cwd(), 'apps/web/out'),
    path.join(process.cwd(), 'packages/server/public'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, 'index.html'))) {
      return candidate;
    }
  }

  return null;
}

export class MonitorServer {
  private server: http.Server;
  private port: number;
  private host: string;
  private repository: SessionRepository;
  private eventBus: EventBus;
  private policyEngine: PolicyEngine;
  private publicDir: string | null;

  constructor(options: ServerOptions) {
    this.port = options.port ?? 4040;
    this.host = options.host || '127.0.0.1';
    this.repository = options.repository;
    this.eventBus = options.eventBus;
    this.policyEngine = options.policyEngine || new PolicyEngine();
    this.publicDir = findPublicDir(options.publicDir);

    this.server = http.createServer((req, res) => this.handleRequest(req, res));
  }

  async start(): Promise<{ port: number; host: string }> {
    return new Promise((resolve, reject) => {
      this.server.listen(this.port, this.host, () => {
        const addr = this.server.address();
        const actualPort = typeof addr === 'object' && addr ? addr.port : this.port;
        this.port = actualPort;
        resolve({ port: actualPort, host: this.host });
      });
      this.server.on('error', reject);
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (typeof this.server.closeAllConnections === 'function') {
        this.server.closeAllConnections();
      }
      this.server.close(() => resolve());
      setTimeout(() => resolve(), 300);
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Last-Event-ID');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const pathname = parsedUrl.pathname;

      // API: Health check
      if (pathname === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', timestamp: Date.now() }));
        return;
      }

      // API: Policy Inspection & Dry-Run Evaluation
      if (pathname === '/policy' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            default: this.policyEngine.getDefaultDecision(),
            timeoutMs: this.policyEngine.getTimeoutMs(),
            rules: this.policyEngine.getRules(),
          })
        );
        return;
      }

      if (pathname === '/policy/evaluate' && req.method === 'POST') {
        const body = await this.readJsonBody(req);
        const action = body.action || {};
        const context = body.context || { workspaceRoot: process.cwd() };
        const evaluation = this.policyEngine.evaluate(action, context);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ evaluation }));
        return;
      }

      // API: List Sessions
      if (pathname === '/sessions' && req.method === 'GET') {
        const limit = Number(parsedUrl.searchParams.get('limit')) || 50;
        const sessions = this.repository.listSessions(limit);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sessions }));
        return;
      }

      // API: Create Session
      if (pathname === '/sessions' && req.method === 'POST') {
        const body = await this.readJsonBody(req);
        const session: AgentSession = {
          id: body.id,
          agentId: body.agentId,
          agentName: body.agentName,
          provider: body.provider,
          model: body.model,
          workspaceRoot: body.workspaceRoot,
          task: body.task,
          startedAt: body.startedAt || Date.now(),
          status: 'running',
          riskScore: 0,
        };

        this.repository.createSession(session);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ session }));
        return;
      }

      // API: Session Approvals
      const sessionApprovalsMatch = pathname.match(/^\/sessions\/([^/]+)\/approvals$/);
      if (sessionApprovalsMatch && req.method === 'GET') {
        const sessionId = sessionApprovalsMatch[1];
        const statusParam = parsedUrl.searchParams.get('status') as any;
        const approvals = this.repository.listApprovals(sessionId, statusParam || undefined);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ approvals }));
        return;
      }

      // API: Direct Approval Actions (/approvals/:id, /approvals/:id/approve, /approvals/:id/deny)
      const approvalMatch = pathname.match(/^\/approvals\/([^/]+)(\/(approve|deny))?$/);
      if (approvalMatch) {
        const approvalId = approvalMatch[1];
        const actionType = approvalMatch[3]; // 'approve' | 'deny' | undefined

        // GET /approvals/:id
        if (!actionType && req.method === 'GET') {
          const approval = this.repository.getApproval(approvalId);
          if (!approval) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Approval request not found' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ approval }));
          return;
        }

        // POST /approvals/:id/approve or /approvals/:id/deny
        if ((actionType === 'approve' || actionType === 'deny') && req.method === 'POST') {
          const body = await this.readJsonBody(req);
          const resolvedBy = body.resolvedBy || 'user_browser';
          const decision = actionType === 'approve' ? 'approved' : 'denied';

          const resResolve = this.repository.resolveApproval(approvalId, decision, resolvedBy);

          if (!resResolve.approval) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Approval request not found' }));
            return;
          }

          if (!resResolve.success) {
            res.writeHead(409, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                error: 'Approval request has already been resolved or expired',
                approval: resResolve.approval,
              })
            );
            return;
          }

          // Authoritative SQLite update succeeded -> derive agentId dynamically (Fix 3)
          const session = this.repository.getSession(resResolve.approval.sessionId);
          const agentId = session?.agentId || 'unknown-agent';

          // Emit exactly ONE authoritative approval.resolved event (Fix 2)
          const resolvedEv: AgentEvent = {
            id: `evt_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
            sequence: this.repository.getNextSequence(resResolve.approval.sessionId),
            sessionId: resResolve.approval.sessionId,
            agentId,
            timestamp: Date.now(),
            type: 'approval.resolved',
            approvalId: resResolve.approval.id,
            actionId: resResolve.approval.actionId,
            decision,
            resolvedBy,
          };
          this.repository.insertEvent(resolvedEv);
          this.eventBus.publish(resolvedEv);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, approval: resResolve.approval }));
          return;
        }
      }

      // API: Session Details & Events
      const sessionMatch = pathname.match(/^\/sessions\/([^/]+)(\/events)?$/);
      if (sessionMatch) {
        const sessionId = sessionMatch[1];
        const isEventsRoute = Boolean(sessionMatch[2]);

        if (!isEventsRoute && req.method === 'GET') {
          const session = this.repository.getSession(sessionId);
          if (!session) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Session not found' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ session }));
          return;
        }

        if (isEventsRoute && req.method === 'GET') {
          const afterSeq = Number(parsedUrl.searchParams.get('afterSeq')) || 0;
          const events = this.repository.getEventsBySession(sessionId, afterSeq);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ events }));
          return;
        }

        if (isEventsRoute && req.method === 'POST') {
          const body = await this.readJsonBody(req);
          const event: AgentEvent = body;

          if (!event.sequence) {
            (event as any).sequence = this.repository.getNextSequence(sessionId);
          }

          this.repository.insertEvent(event);

          if (event.type === 'session.ended') {
            this.repository.updateSession(sessionId, {
              status: event.status,
              endedAt: event.timestamp,
              summary: event.summary,
              riskScore: event.summary.overallRiskScore,
            });
          }

          this.eventBus.publish(event);

          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, event }));
          return;
        }
      }

      // API: Real-time SSE Stream
      if (pathname === '/events/stream' && req.method === 'GET') {
        const sessionId = parsedUrl.searchParams.get('sessionId');
        if (!sessionId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'sessionId query parameter is required' }));
          return;
        }

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });

        res.write(`: connected\n\n`);

        const lastEventId = req.headers['last-event-id'];
        const afterSeqParam = parsedUrl.searchParams.get('afterSeq');

        if (lastEventId !== undefined || afterSeqParam !== null) {
          const afterSeq = Number(lastEventId || afterSeqParam) || 0;
          const missedEvents = this.repository.getEventsBySession(sessionId, afterSeq);
          for (const ev of missedEvents) {
            res.write(`id: ${ev.sequence}\nevent: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
          }
        }

        const heartbeat = setInterval(() => {
          res.write(`: heartbeat\n\n`);
        }, 15000);

        const unsubscribe = this.eventBus.subscribe(sessionId, (event) => {
          res.write(`id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        });

        req.on('close', () => {
          clearInterval(heartbeat);
          unsubscribe();
        });
        return;
      }

      // Static UI File Serving (Serves Next.js exported Dashboard UI)
      if (this.publicDir && req.method === 'GET') {
        let filePath = path.join(this.publicDir, pathname === '/' ? 'index.html' : pathname);

        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          filePath = path.join(this.publicDir, 'index.html');
        }

        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          const ext = path.extname(filePath).toLowerCase();
          const contentType = MIME_TYPES[ext] || 'application/octet-stream';
          const fileContent = fs.readFileSync(filePath);

          res.writeHead(200, {
            'Content-Type': contentType,
            'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
          });
          res.end(fileContent);
          return;
        }
      }

      // Fallback API 404
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Endpoint not found' }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message || 'Internal Server Error' }));
    }
  }

  private readJsonBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 10 * 1024 * 1024) {
          reject(new Error('Payload too large'));
        }
      });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch {
          reject(new Error('Invalid JSON'));
        }
      });
      req.on('error', reject);
    });
  }
}

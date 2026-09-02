import http from 'node:http';
import { URL } from 'node:url';
import { AgentEvent, AgentSession } from '@agent-monitor/core';
import { SessionRepository } from './db/repository.js';
import { EventBus } from './bus.js';

export interface ServerOptions {
  port?: number;
  host?: string;
  repository: SessionRepository;
  eventBus: EventBus;
}

export class MonitorServer {
  private server: http.Server;
  private port: number;
  private host: string;
  private repository: SessionRepository;
  private eventBus: EventBus;

  constructor(options: ServerOptions) {
    this.port = options.port || 4040;
    this.host = options.host || '127.0.0.1';
    this.repository = options.repository;
    this.eventBus = options.eventBus;

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
      this.server.close(() => resolve());
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

      if (pathname === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', timestamp: Date.now() }));
        return;
      }

      if (pathname === '/sessions' && req.method === 'GET') {
        const limit = Number(parsedUrl.searchParams.get('limit')) || 50;
        const sessions = this.repository.listSessions(limit);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sessions }));
        return;
      }

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
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        });

        res.write(`: connected\n\n`);

        const lastEventId = req.headers['last-event-id'];
        const afterSeq = Number(lastEventId || parsedUrl.searchParams.get('afterSeq')) || 0;

        if (afterSeq > 0) {
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
        } catch (err) {
          reject(new Error('Invalid JSON'));
        }
      });
      req.on('error', reject);
    });
  }
}

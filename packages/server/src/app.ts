import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { URL } from "node:url";
import {
  AgentEvent,
  AgentSession,
  ApprovalRequest,
  PolicyEngine,
  calculateSessionRisk,
  verifyEventChain,
  IncidentSeverity,
  IncidentTrigger,
} from "@agent-monitor/core";
import { SessionRepository } from "./db/repository.js";
import { EventBus } from "./bus.js";
import { checkDatabaseHealth } from "./db/database.js";

export interface ServerOptions {
  port?: number;
  host?: string;
  repository: SessionRepository;
  eventBus: EventBus;
  policyEngine?: PolicyEngine;
  publicDir?: string;
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function findPublicDir(customDir?: string): string | null {
  if (customDir && fs.existsSync(customDir)) {
    return customDir;
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const candidates = [
    path.join(__dirname, "../public"),
    path.join(__dirname, "public"),
    path.join(__dirname, "../../public"),
    path.join(__dirname, "../../../apps/web/out"),
    path.join(process.cwd(), "apps/web/out"),
    path.join(process.cwd(), "packages/server/public"),
  ];

  for (const candidate of candidates) {
    if (
      fs.existsSync(candidate) &&
      fs.existsSync(path.join(candidate, "index.html"))
    ) {
      return candidate;
    }
  }

  return null;
}

function isAllowedOrigin(origin?: string): boolean {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const hostname = parsed.hostname;
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]" ||
      hostname === "::1"
    );
  } catch {
    return false;
  }
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
    this.host = options.host || "127.0.0.1";
    this.repository = options.repository;
    this.eventBus = options.eventBus;
    this.policyEngine = options.policyEngine || new PolicyEngine();
    this.publicDir = findPublicDir(options.publicDir);

    this.server = http.createServer((req, res) => this.handleRequest(req, res));

    // Synchronize policyEngine with authoritative SQLite policy_versions
    const activePolicy = this.repository.getActivePolicyVersion();
    if (activePolicy) {
      this.policyEngine.setRules(activePolicy.rules);
      this.policyEngine.setDefaultDecision(activePolicy.defaultDecision);
      this.policyEngine.setTimeoutMs(activePolicy.timeoutMs);
    } else {
      this.repository.createPolicyVersion({
        name: "Baseline Policy v1",
        description: "Initial baseline security policy version",
        rules: this.policyEngine.getRules(),
        defaultDecision: this.policyEngine.getDefaultDecision(),
        timeoutMs: this.policyEngine.getTimeoutMs(),
        createdBy: "system",
        changeSummary: "Automatic bootstrap from defaults",
        activate: true,
      });
    }
  }

  async start(): Promise<{ port: number; host: string }> {
    return new Promise((resolve, reject) => {
      this.server.listen(this.port, this.host, () => {
        const addr = this.server.address();
        const actualPort =
          typeof addr === "object" && addr ? addr.port : this.port;
        this.port = actualPort;
        resolve({ port: actualPort, host: this.host });
      });
      this.server.on("error", reject);
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      try {
        this.repository.expirePendingApprovals(0);
      } catch {}

      if (typeof this.server.closeAllConnections === "function") {
        this.server.closeAllConnections();
      }
      this.server.close(() => {
        try {
          const db = (this.repository as any).db;
          if (db && typeof db.pragma === "function") {
            db.pragma("wal_checkpoint(TRUNCATE)");
          }
        } catch {}
        resolve();
      });
      setTimeout(() => resolve(), 500);
    });
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const origin = req.headers.origin;
    const isAllowed = isAllowedOrigin(origin);

    if (origin) {
      if (isAllowed) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Credentials", "true");
      }
    }

    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Last-Event-ID",
    );

    if (req.method === "OPTIONS") {
      if (origin && !isAllowed) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Forbidden: Origin not allowed" }));
        return;
      }
      res.writeHead(204);
      res.end();
      return;
    }

    if (origin && !isAllowed) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ error: "Forbidden: Cross-origin request denied" }),
      );
      return;
    }

    try {
      const parsedUrl = new URL(
        req.url || "/",
        `http://${req.headers.host || "localhost"}`,
      );
      const pathname = parsedUrl.pathname;

      // API: Health check with database diagnostics
      if (pathname === "/health" && req.method === "GET") {
        const dbHealth = checkDatabaseHealth((this.repository as any).db);
        const statusCode = dbHealth.status === "ok" ? 200 : 503;
        res.writeHead(statusCode, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: dbHealth.status,
            database: dbHealth,
            timestamp: Date.now(),
            version: "4.1.0",
          }),
        );
        return;
      }

      // API: Audit Ledger Export
      if (pathname === "/audit/export" && req.method === "GET") {
        const sessionId = parsedUrl.searchParams.get("sessionId") || undefined;
        const ledgerJson = this.repository.exportLedger(sessionId);
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="audit-ledger-${sessionId || "all"}-${Date.now()}.json"`,
        });
        res.end(ledgerJson);
        return;
      }

      // API: Policy Inspection & Dry-Run Evaluation
      if (pathname === "/policy" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            default: this.policyEngine.getDefaultDecision(),
            timeoutMs: this.policyEngine.getTimeoutMs(),
            rules: this.policyEngine.getRules(),
          }),
        );
        return;
      }

      if (pathname === "/policy/evaluate" && req.method === "POST") {
        const body = await this.readJsonBody(req);
        const action = body.action || {};
        const context = body.context || { workspaceRoot: process.cwd() };
        const evaluation = this.policyEngine.evaluate(action, context);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ evaluation }));
        return;
      }

      // API: V4 Policy Versioning & Management
      if (pathname === "/policy/versions" && req.method === "GET") {
        const versions = this.repository.listPolicyVersions();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ versions }));
        return;
      }

      if (pathname === "/policy/versions/active" && req.method === "GET") {
        const version = this.repository.getActivePolicyVersion();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ version }));
        return;
      }

      if (pathname === "/policy/versions/diff" && req.method === "GET") {
        const vA = Number(parsedUrl.searchParams.get("vA"));
        const vB = Number(parsedUrl.searchParams.get("vB"));
        if (!vA || !vB) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "Query parameters vA and vB are required",
            }),
          );
          return;
        }
        try {
          const diff = this.repository.diffPolicyVersions(vA, vB);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ diff }));
          return;
        } catch (err: any) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
          return;
        }
      }

      if (pathname === "/policy/history" && req.method === "GET") {
        const limit = Number(parsedUrl.searchParams.get("limit")) || 50;
        const history = this.repository.getPolicyAuditLog(limit);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ history }));
        return;
      }

      const policyVersionMatch = pathname.match(
        /^\/policy\/versions\/([^/]+)(\/(activate|rollback))?$/,
      );
      if (policyVersionMatch) {
        const versionParam = policyVersionMatch[1];
        const actionType = policyVersionMatch[3]; // 'activate' | 'rollback' | undefined

        if (!actionType && req.method === "GET") {
          const version = this.repository.getPolicyVersion(versionParam);
          if (!version) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Policy version not found" }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ version }));
          return;
        }

        if (actionType === "activate" && req.method === "POST") {
          const body = await this.readJsonBody(req).catch(() => ({}));
          const actor = body?.actor || "operator";
          try {
            const version = this.repository.activatePolicyVersion(
              versionParam,
              actor,
            );
            this.emitPolicyChangedEvent("activated", version.id, actor);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, version }));
            return;
          } catch (err: any) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: err.message }));
            return;
          }
        }

        if (actionType === "rollback" && req.method === "POST") {
          const body = await this.readJsonBody(req).catch(() => ({}));
          const actor = body?.actor || "operator";
          try {
            const version = this.repository.rollbackPolicyVersion(
              Number(versionParam),
              actor,
            );
            this.emitPolicyChangedEvent("rolled_back", version.id, actor);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, version }));
            return;
          } catch (err: any) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: err.message }));
            return;
          }
        }
      }

      if (pathname === "/policy/versions" && req.method === "POST") {
        const body = await this.readJsonBody(req);
        if (!body.name || !Array.isArray(body.rules)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "Version name and rules array are required",
            }),
          );
          return;
        }
        const created = this.repository.createPolicyVersion({
          name: body.name,
          description: body.description,
          rules: body.rules,
          defaultDecision: body.defaultDecision,
          timeoutMs: body.timeoutMs,
          createdBy: body.createdBy || "operator",
          changeSummary: body.changeSummary,
          activate: body.activate,
        });

        if (created.isActive) {
          this.emitPolicyChangedEvent("created", created.id, created.createdBy);
        }

        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ version: created }));
        return;
      }

      const ruleToggleMatch = pathname.match(
        /^\/policy\/rules\/([^/]+)\/toggle$/,
      );
      if (ruleToggleMatch && req.method === "POST") {
        const ruleId = ruleToggleMatch[1];
        const body = await this.readJsonBody(req);
        const enabled = Boolean(body.enabled);
        const actor = body.actor || "operator";
        try {
          const version = this.repository.togglePolicyRule(
            ruleId,
            enabled,
            actor,
          );
          this.emitPolicyChangedEvent(
            "rule_toggled",
            version.id,
            actor,
            ruleId,
          );
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, version }));
          return;
        } catch (err: any) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
          return;
        }
      }

      // API: V4 Security Incident Management
      if (pathname === "/incidents" && req.method === "GET") {
        const sessionId = parsedUrl.searchParams.get("sessionId") || undefined;
        const status =
          (parsedUrl.searchParams.get("status") as any) || undefined;
        const severity =
          (parsedUrl.searchParams.get("severity") as any) || undefined;
        const limit = Number(parsedUrl.searchParams.get("limit")) || 50;

        const incidents = this.repository.listIncidents({
          sessionId,
          status,
          severity,
          limit,
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ incidents }));
        return;
      }

      if (pathname === "/incidents" && req.method === "POST") {
        const body = await this.readJsonBody(req);
        if (!body.sessionId || !body.title) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ error: "sessionId and title are required" }),
          );
          return;
        }

        const incident = this.repository.createIncident({
          sessionId: body.sessionId,
          severity: body.severity || "MEDIUM",
          triggerType: body.triggerType || "OPERATOR_MANUAL",
          title: body.title,
          description: body.description || "",
          triggerEventId: body.triggerEventId,
          relatedEventIds: body.relatedEventIds,
        });

        const incEv: AgentEvent = {
          id: `evt_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
          sequence: this.repository.getNextSequence(incident.sessionId),
          sessionId: incident.sessionId,
          agentId: "control-plane",
          timestamp: Date.now(),
          type: "incident.created",
          incidentId: incident.id,
          incidentNumber: incident.incidentNumber,
          severity: incident.severity,
          triggerType: incident.triggerType,
          title: incident.title,
        };
        this.repository.insertEvent(incEv);
        this.eventBus.publish(incEv);

        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ incident }));
        return;
      }

      const incidentMatch = pathname.match(/^\/incidents\/([^/]+)(\/events)?$/);
      if (incidentMatch) {
        const incidentId = incidentMatch[1];
        const isEvents = Boolean(incidentMatch[2]);

        if (isEvents && req.method === "GET") {
          const events = this.repository.getIncidentEvents(incidentId);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ events }));
          return;
        }

        if (!isEvents && req.method === "GET") {
          const incident = this.repository.getIncident(incidentId);
          if (!incident) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Incident not found" }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ incident }));
          return;
        }

        if (!isEvents && req.method === "PATCH") {
          const body = await this.readJsonBody(req);
          const updated = this.repository.updateIncident(incidentId, {
            status: body.status,
            severity: body.severity,
            resolvedBy: body.resolvedBy,
            resolutionNotes: body.resolutionNotes,
          });

          if (!updated) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Incident not found" }));
            return;
          }

          const incUpdateEv: AgentEvent = {
            id: `evt_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
            sequence: this.repository.getNextSequence(updated.sessionId),
            sessionId: updated.sessionId,
            agentId: "control-plane",
            timestamp: Date.now(),
            type: "incident.updated",
            incidentId: updated.id,
            status: updated.status,
            updatedBy: body.resolvedBy,
            notes: body.resolutionNotes,
          };
          this.repository.insertEvent(incUpdateEv);
          this.eventBus.publish(incUpdateEv);

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ incident: updated }));
          return;
        }
      }

      // API: V4 MCP Source Registry & Quarantine
      if (pathname === "/mcp/sources" && req.method === "GET") {
        const sources = this.repository.listMcpSources();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ sources }));
        return;
      }

      const mcpSourceMatch = pathname.match(
        /^\/mcp\/sources\/([^/]+)(\/(quarantine|trust))?$/,
      );
      if (mcpSourceMatch) {
        const sourceId = decodeURIComponent(mcpSourceMatch[1]);
        const actionType = mcpSourceMatch[3]; // 'quarantine' | 'trust' | undefined

        if (!actionType && req.method === "GET") {
          const source = this.repository.getMcpSource(sourceId);
          if (!source) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "MCP source not found" }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ source }));
          return;
        }

        if (actionType === "quarantine" && req.method === "POST") {
          const body = await this.readJsonBody(req).catch(() => ({}));
          const reason = body?.reason || "Quarantined by operator";
          const actor = body?.actor || "operator";

          try {
            const source = this.repository.quarantineMcpSource(
              sourceId,
              reason,
              actor,
            );

            const quarEv: AgentEvent = {
              id: `evt_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
              sequence: 1,
              sessionId: "global",
              agentId: "control-plane",
              timestamp: Date.now(),
              type: "mcp.quarantined",
              sourceId,
              reason,
              quarantinedBy: actor,
            };
            this.eventBus.publish(quarEv);

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, source }));
            return;
          } catch (err: any) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: err.message }));
            return;
          }
        }

        if (actionType === "trust" && req.method === "POST") {
          try {
            const source = this.repository.trustMcpSource(sourceId);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, source }));
            return;
          } catch (err: any) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: err.message }));
            return;
          }
        }
      }

      // API: V4 Event Investigation Query Engine
      if (pathname === "/events" && req.method === "GET") {
        const sessionId = parsedUrl.searchParams.get("sessionId") || undefined;
        const type = parsedUrl.searchParams.get("type") || undefined;
        const tool = parsedUrl.searchParams.get("tool") || undefined;
        const risk = parsedUrl.searchParams.get("risk") || undefined;
        const since = parsedUrl.searchParams.get("since");
        const until = parsedUrl.searchParams.get("until");
        const limit = Number(parsedUrl.searchParams.get("limit")) || 100;
        const offset = Number(parsedUrl.searchParams.get("offset")) || 0;

        const events = this.repository.queryEvents({
          sessionId,
          type,
          toolName: tool,
          riskLevel: risk,
          since: since ? Number(since) : undefined,
          until: until ? Number(until) : undefined,
          limit,
          offset,
        });

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ events, count: events.length }));
        return;
      }

      // API: V4 Audit Verification Engine
      if (pathname === "/audit/verify" && req.method === "GET") {
        const sessionId = parsedUrl.searchParams.get("sessionId");
        if (!sessionId) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ error: "sessionId query parameter is required" }),
          );
          return;
        }

        const events = this.repository.getEventsBySession(sessionId, 0);
        const verification = verifyEventChain(events as any);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ verification }));
        return;
      }

      // API: List Sessions
      if (pathname === "/sessions" && req.method === "GET") {
        const limit = Number(parsedUrl.searchParams.get("limit")) || 50;
        const sessions = this.repository.listSessions(limit);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ sessions }));
        return;
      }

      // API: Create Session
      if (pathname === "/sessions" && req.method === "POST") {
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
          status: "running",
          riskScore: 0,
        };

        this.repository.createSession(session);
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ session }));
        return;
      }

      // API: Session Approvals
      const sessionApprovalsMatch = pathname.match(
        /^\/sessions\/([^/]+)\/approvals$/,
      );
      if (sessionApprovalsMatch && req.method === "GET") {
        const sessionId = sessionApprovalsMatch[1];
        const statusParam = parsedUrl.searchParams.get("status") as any;
        const approvals = this.repository.listApprovals(
          sessionId,
          statusParam || undefined,
        );

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ approvals }));
        return;
      }

      // API: Direct Approval Actions (/approvals/:id, /approvals/:id/approve, /approvals/:id/deny)
      const approvalMatch = pathname.match(
        /^\/approvals\/([^/]+)(\/(approve|deny))?$/,
      );
      if (approvalMatch) {
        const approvalId = approvalMatch[1];
        const actionType = approvalMatch[3]; // 'approve' | 'deny' | undefined

        // GET /approvals/:id
        if (!actionType && req.method === "GET") {
          const approval = this.repository.getApproval(approvalId);
          if (!approval) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Approval request not found" }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ approval }));
          return;
        }

        // POST /approvals/:id/approve or /approvals/:id/deny
        if (
          (actionType === "approve" || actionType === "deny") &&
          req.method === "POST"
        ) {
          const body = await this.readJsonBody(req);
          const resolvedBy = body.resolvedBy || "user_browser";
          const decision = actionType === "approve" ? "approved" : "denied";

          const resResolve = this.repository.resolveApproval(
            approvalId,
            decision,
            resolvedBy,
          );

          if (!resResolve.approval) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Approval request not found" }));
            return;
          }

          if (!resResolve.success) {
            res.writeHead(409, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: "Approval request has already been resolved or expired",
                approval: resResolve.approval,
              }),
            );
            return;
          }

          // Authoritative SQLite update succeeded -> derive agentId dynamically (Fix 3)
          const session = this.repository.getSession(
            resResolve.approval.sessionId,
          );
          const agentId = session?.agentId || "unknown-agent";

          // Emit exactly ONE authoritative approval.resolved event (Fix 2)
          const resolvedEv: AgentEvent = {
            id: `evt_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
            sequence: this.repository.getNextSequence(
              resResolve.approval.sessionId,
            ),
            sessionId: resResolve.approval.sessionId,
            agentId,
            timestamp: Date.now(),
            type: "approval.resolved",
            approvalId: resResolve.approval.id,
            actionId: resResolve.approval.actionId,
            decision,
            resolvedBy,
          };
          this.repository.insertEvent(resolvedEv);
          this.eventBus.publish(resolvedEv);

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ success: true, approval: resResolve.approval }),
          );
          return;
        }
      }

      // API: Session Details & Events
      const sessionMatch = pathname.match(/^\/sessions\/([^/]+)(\/events)?$/);
      if (sessionMatch) {
        const sessionId = sessionMatch[1];
        const isEventsRoute = Boolean(sessionMatch[2]);

        if (!isEventsRoute && req.method === "GET") {
          const session = this.repository.getSession(sessionId);
          if (!session) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Session not found" }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ session }));
          return;
        }

        if (isEventsRoute && req.method === "GET") {
          const afterSeq = Number(parsedUrl.searchParams.get("afterSeq")) || 0;
          const events = this.repository.getEventsBySession(
            sessionId,
            afterSeq,
          );
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ events }));
          return;
        }

        if (isEventsRoute && req.method === "POST") {
          const body = await this.readJsonBody(req);
          const event: AgentEvent = body;

          if (!event.sequence) {
            (event as any).sequence =
              this.repository.getNextSequence(sessionId);
          }

          this.repository.insertEvent(event);

          if (event.type === "session.ended") {
            this.repository.updateSession(sessionId, {
              status: event.status,
              endedAt: event.timestamp,
              summary: event.summary,
              riskScore: event.summary.overallRiskScore,
            });
          }

          this.eventBus.publish(event);

          // Automated Incident Creation (V4)
          this.autoCreateIncidentIfNeeded(event);

          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, event }));
          return;
        }
      }

      // API: V4 Session Risk Breakdown
      const riskBreakdownMatch = pathname.match(
        /^\/sessions\/([^/]+)\/risk-breakdown$/,
      );
      if (riskBreakdownMatch && req.method === "GET") {
        const sessionId = riskBreakdownMatch[1];
        const events = this.repository.getEventsBySession(sessionId, 0);
        const breakdown = calculateSessionRisk(sessionId, events);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ breakdown }));
        return;
      }

      // API: V0.3 Kill Switch Controls
      const killMatch = pathname.match(/^\/sessions\/([^/]+)\/kill$/);
      if (killMatch && req.method === "POST") {
        const sessionId = killMatch[1];
        const body = await this.readJsonBody(req).catch(() => ({}));
        const reason = body?.reason || "Operator kill switch triggered via API";
        const actor = body?.actor || "operator";

        this.repository.setKillSwitch(sessionId, true, reason, actor);

        const killEv: any = {
          id: `evt_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
          sequence: this.repository.getNextSequence(sessionId),
          sessionId,
          agentId: "control",
          timestamp: Date.now(),
          type: "control.kill_switch_enabled",
          activatedBy: actor,
          reason,
        };
        this.repository.insertEvent(killEv);
        this.eventBus.publish(killEv);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            controlState: this.repository.getControlState(sessionId),
          }),
        );
        return;
      }

      const resumeMatch = pathname.match(/^\/sessions\/([^/]+)\/resume$/);
      if (resumeMatch && req.method === "POST") {
        const sessionId = resumeMatch[1];
        const body = await this.readJsonBody(req).catch(() => ({}));
        const actor = body?.actor || "operator";

        this.repository.setKillSwitch(sessionId, false, undefined, actor);

        const resumeEv: any = {
          id: `evt_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
          sequence: this.repository.getNextSequence(sessionId),
          sessionId,
          agentId: "control",
          timestamp: Date.now(),
          type: "control.kill_switch_disabled",
          resumedBy: actor,
        };
        this.repository.insertEvent(resumeEv);
        this.eventBus.publish(resumeEv);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            controlState: this.repository.getControlState(sessionId),
          }),
        );
        return;
      }

      const controlMatch = pathname.match(/^\/sessions\/([^/]+)\/control$/);
      if (controlMatch && req.method === "GET") {
        const sessionId = controlMatch[1];
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            controlState: this.repository.getControlState(sessionId),
          }),
        );
        return;
      }

      // API: V0.3 Tool Fingerprints
      const toolsMatch = pathname.match(/^\/sessions\/([^/]+)\/tools$/);
      if (toolsMatch && req.method === "GET") {
        const sessionId = toolsMatch[1];
        const tools = this.repository.getToolFingerprints(sessionId);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ tools }));
        return;
      }

      // API: V0.3 Behavioral Security Flows
      const flowsMatch = pathname.match(
        /^\/sessions\/([^/]+)\/security-flows$/,
      );
      if (flowsMatch && req.method === "GET") {
        const sessionId = flowsMatch[1];
        const matches = this.repository.getBehavioralMatches(sessionId);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ matches }));
        return;
      }

      // API: Real-time SSE Stream
      if (pathname === "/events/stream" && req.method === "GET") {
        const sessionId = parsedUrl.searchParams.get("sessionId");
        if (!sessionId) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ error: "sessionId query parameter is required" }),
          );
          return;
        }

        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });

        res.write(`: connected\n\n`);

        const lastEventId = req.headers["last-event-id"];
        const afterSeqParam = parsedUrl.searchParams.get("afterSeq");

        if (lastEventId !== undefined || afterSeqParam !== null) {
          const afterSeq = Number(lastEventId || afterSeqParam) || 0;
          const missedEvents = this.repository.getEventsBySession(
            sessionId,
            afterSeq,
          );
          for (const ev of missedEvents) {
            res.write(
              `id: ${ev.sequence}\nevent: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`,
            );
          }
        }

        const heartbeat = setInterval(() => {
          res.write(`: heartbeat\n\n`);
        }, 15000);

        const unsubscribe = this.eventBus.subscribe(sessionId, (event) => {
          res.write(
            `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
          );
        });

        req.on("close", () => {
          clearInterval(heartbeat);
          unsubscribe();
        });
        return;
      }

      // Static UI File Serving (Serves Next.js exported Dashboard UI)
      if (this.publicDir && req.method === "GET") {
        let filePath = path.join(
          this.publicDir,
          pathname === "/" ? "index.html" : pathname,
        );

        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          filePath = path.join(this.publicDir, "index.html");
        }

        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          const ext = path.extname(filePath).toLowerCase();
          const contentType = MIME_TYPES[ext] || "application/octet-stream";
          const fileContent = fs.readFileSync(filePath);

          res.writeHead(200, {
            "Content-Type": contentType,
            "Cache-Control":
              ext === ".html"
                ? "no-cache"
                : "public, max-age=31536000, immutable",
          });
          res.end(fileContent);
          return;
        }
      }

      // Fallback API 404
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Endpoint not found" }));
    } catch (err: any) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ error: err.message || "Internal Server Error" }),
      );
    }
  }

  private readJsonBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
        if (body.length > 10 * 1024 * 1024) {
          reject(new Error("Payload too large"));
        }
      });
      req.on("end", () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch {
          reject(new Error("Invalid JSON"));
        }
      });
      req.on("error", reject);
    });
  }

  private emitPolicyChangedEvent(
    action: "created" | "activated" | "rolled_back" | "rule_toggled",
    versionId: string,
    actor: string,
    ruleId?: string,
  ): void {
    const activeVersion = this.repository.getActivePolicyVersion();
    if (activeVersion) {
      this.policyEngine.setRules(activeVersion.rules);
      this.policyEngine.setDefaultDecision(activeVersion.defaultDecision);
      this.policyEngine.setTimeoutMs(activeVersion.timeoutMs);
    }

    const ev: AgentEvent = {
      id: `evt_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
      sequence: 1,
      sessionId: "global",
      agentId: "control-plane",
      timestamp: Date.now(),
      type: "policy.changed",
      action,
      versionId,
      ruleId,
      actor,
    };
    this.eventBus.publish(ev);
  }

  private autoCreateIncidentIfNeeded(event: AgentEvent): void {
    let triggerType: IncidentTrigger | null = null;
    let severity: IncidentSeverity = "MEDIUM";
    let title = "";
    let description = "";

    if (event.type === "action.blocked") {
      const reason = (event as any).reason || "";
      if (
        reason.toLowerCase().includes("private key") ||
        reason.toLowerCase().includes("secret pattern")
      ) {
        triggerType = "PRIVATE_KEY_LEAK";
        severity = "CRITICAL";
        title = "Private Key / Secret Leak Blocked";
        description = `An action attempted to leak sensitive credentials or private keys: ${reason}`;
      } else if (
        reason.toLowerCase().includes("outside workspace") ||
        reason.toLowerCase().includes("rfc 8089")
      ) {
        triggerType = "WORKSPACE_ESCAPE";
        severity = "HIGH";
        title = "Workspace Boundary Escape Attempt";
        description = `Action '${(event as any).kind}' attempted to access files outside workspace: ${reason}`;
      } else if (reason.toLowerCase().includes("mutated")) {
        triggerType = "TOOL_MUTATION";
        severity = "HIGH";
        title = "Mutated Tool Schema Execution Blocked";
        description = `Action '${(event as any).kind}' was blocked due to an unapproved tool schema mutation`;
      } else if (reason.toLowerCase().includes("quarantined")) {
        triggerType = "SOURCE_QUARANTINED";
        severity = "CRITICAL";
        title = "Quarantined MCP Source Blocked";
        description = reason;
      }
    } else if (event.type === "action.completed") {
      const flags = (event as any).risk?.flags || [];
      if (flags.some((f: any) => f.ruleId === "SECRET_LEAK_OUTPUT")) {
        triggerType = "PRIVATE_KEY_LEAK";
        severity = "CRITICAL";
        title = "Potential Secret Leak in Action Output";
        description = `Sensitive credentials or secrets detected in output of '${(event as any).kind}'`;
      }
    } else if (event.type === "behavioral.match") {
      const match = (event as any).match;
      if (
        match &&
        (match.severity === "CRITICAL" || match.severity === "HIGH")
      ) {
        triggerType = "BEHAVIORAL_VIOLATION";
        severity = match.severity;
        title = `Suspicious Behavioral Sequence: ${match.name}`;
        description = match.reason;
      }
    } else if (event.type === "control.kill_switch_enabled") {
      triggerType = "KILL_SWITCH_ACTIVATION";
      severity = "HIGH";
      title = "Authoritative Kill Switch Activated";
      description =
        (event as any).reason || "Session was aborted by kill switch";
    }

    if (triggerType) {
      const incident = this.repository.createIncident({
        sessionId: event.sessionId,
        severity,
        triggerType,
        title,
        description,
        triggerEventId: event.id,
        relatedEventIds: [event.id],
      });

      const incEvent: AgentEvent = {
        id: `evt_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
        sequence: this.repository.getNextSequence(event.sessionId),
        sessionId: event.sessionId,
        agentId: event.agentId || "control-plane",
        timestamp: Date.now(),
        type: "incident.created",
        incidentId: incident.id,
        incidentNumber: incident.incidentNumber,
        severity: incident.severity,
        triggerType: incident.triggerType,
        title: incident.title,
      };
      this.repository.insertEvent(incEvent);
      this.eventBus.publish(incEvent);
    }
  }
}

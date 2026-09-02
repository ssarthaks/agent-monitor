import { Database } from 'better-sqlite3';
import { AgentEvent, AgentSession, ApprovalRequest, ApprovalStatus } from '@agent-monitor/core';

export class SessionRepository {
  constructor(private db: Database) {}

  // ─────────────────────────────────────────────────────────────
  // Session Persistence
  // ─────────────────────────────────────────────────────────────

  createSession(session: AgentSession): void {
    const stmt = this.db.prepare(`
      INSERT INTO sessions (
        id, agent_id, agent_name, provider, model, workspace_root, task,
        started_at, ended_at, status, risk_score, summary_json
      ) VALUES (
        @id, @agentId, @agentName, @provider, @model, @workspaceRoot, @task,
        @startedAt, @endedAt, @status, @riskScore, @summaryJson
      )
    `);

    stmt.run({
      id: session.id,
      agentId: session.agentId,
      agentName: session.agentName,
      provider: session.provider,
      model: session.model,
      workspaceRoot: session.workspaceRoot,
      task: session.task,
      startedAt: session.startedAt,
      endedAt: session.endedAt ?? null,
      status: session.status,
      riskScore: session.riskScore || 0,
      summaryJson: session.summary ? JSON.stringify(session.summary) : null,
    });
  }

  getSession(id: string): AgentSession | null {
    const stmt = this.db.prepare(`SELECT * FROM sessions WHERE id = ?`);
    const row = stmt.get(id) as any;
    if (!row) return null;

    let status = row.status;
    let endedAt = row.ended_at;
    let summary = row.summary_json ? JSON.parse(row.summary_json) : null;
    let riskScore = row.risk_score;

    if (status === 'running') {
      const endedEventRow = this.db
        .prepare(`SELECT payload_json FROM events WHERE session_id = ? AND type = 'session.ended' LIMIT 1`)
        .get(id) as any;

      if (endedEventRow) {
        const endedEvent = JSON.parse(endedEventRow.payload_json);
        status = endedEvent.status || 'completed';
        endedAt = endedEvent.timestamp;
        summary = endedEvent.summary || summary;
        riskScore = Math.max(riskScore, endedEvent.summary?.overallRiskScore || 0);

        this.db
          .prepare(`UPDATE sessions SET status = ?, ended_at = ?, summary_json = ?, risk_score = ? WHERE id = ?`)
          .run(status, endedAt, JSON.stringify(summary), riskScore, id);
      }
    }

    return {
      id: row.id,
      agentId: row.agent_id,
      agentName: row.agent_name,
      provider: row.provider,
      model: row.model,
      workspaceRoot: row.workspace_root,
      task: row.task,
      startedAt: row.started_at,
      endedAt,
      status,
      riskScore,
      summary,
    };
  }

  listSessions(limit: number = 50): AgentSession[] {
    const stmt = this.db.prepare(`SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?`);
    const rows = stmt.all(limit) as any[];

    return rows.map((row) => {
      let status = row.status;
      let endedAt = row.ended_at;
      let summary = row.summary_json ? JSON.parse(row.summary_json) : null;
      let riskScore = row.risk_score;

      if (status === 'running') {
        const endedEventRow = this.db
          .prepare(`SELECT payload_json FROM events WHERE session_id = ? AND type = 'session.ended' LIMIT 1`)
          .get(row.id) as any;

        if (endedEventRow) {
          const endedEvent = JSON.parse(endedEventRow.payload_json);
          status = endedEvent.status || 'completed';
          endedAt = endedEvent.timestamp;
          summary = endedEvent.summary || summary;
          riskScore = Math.max(riskScore, endedEvent.summary?.overallRiskScore || 0);

          this.db
            .prepare(`UPDATE sessions SET status = ?, ended_at = ?, summary_json = ?, risk_score = ? WHERE id = ?`)
            .run(status, endedAt, JSON.stringify(summary), riskScore, row.id);
        }
      }

      return {
        id: row.id,
        agentId: row.agent_id,
        agentName: row.agent_name,
        provider: row.provider,
        model: row.model,
        workspaceRoot: row.workspace_root,
        task: row.task,
        startedAt: row.started_at,
        endedAt,
        status,
        riskScore,
        summary,
      };
    });
  }

  updateSession(
    id: string,
    updates: {
      status?: AgentSession['status'];
      endedAt?: number;
      summary?: any;
      riskScore?: number;
    }
  ): void {
    const fields: string[] = [];
    const params: Record<string, any> = { id };

    if (updates.status !== undefined) {
      fields.push('status = @status');
      params.status = updates.status;
    }
    if (updates.endedAt !== undefined) {
      fields.push('ended_at = @endedAt');
      params.endedAt = updates.endedAt;
    }
    if (updates.summary !== undefined) {
      fields.push('summary_json = @summaryJson');
      params.summaryJson = JSON.stringify(updates.summary);
    }
    if (updates.riskScore !== undefined) {
      fields.push('risk_score = @riskScore');
      params.riskScore = updates.riskScore;
    }

    if (fields.length === 0) return;

    const stmt = this.db.prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = @id`);
    stmt.run(params);
  }

  getNextSequence(sessionId: string): number {
    const stmt = this.db.prepare(`SELECT MAX(sequence) as max_seq FROM events WHERE session_id = ?`);
    const row = stmt.get(sessionId) as any;
    return (row?.max_seq || 0) + 1;
  }

  // ─────────────────────────────────────────────────────────────
  // Event Persistence
  // ─────────────────────────────────────────────────────────────

  insertEvent(event: AgentEvent): void {
    const stmt = this.db.prepare(`
      INSERT INTO events (
        id, session_id, sequence, type, timestamp,
        action_id, action_kind, payload_json,
        risk_level, risk_score, risk_flags_json
      ) VALUES (
        @id, @sessionId, @sequence, @type, @timestamp,
        @actionId, @actionKind, @payloadJson,
        @riskLevel, @riskScore, @riskFlagsJson
      )
    `);

    let actionId: string | null = null;
    let actionKind: string | null = null;
    let riskLevel: string | null = null;
    let riskScore: number | null = null;
    let riskFlagsJson: string | null = null;

    if ('actionId' in event) {
      actionId = event.actionId;
    }
    if ('kind' in event) {
      actionKind = event.kind;
    }
    if ('risk' in event && event.risk) {
      riskLevel = event.risk.level;
      riskScore = event.risk.score;
      riskFlagsJson = JSON.stringify(event.risk.flags);
    }

    stmt.run({
      id: event.id,
      sessionId: event.sessionId,
      sequence: event.sequence,
      type: event.type,
      timestamp: event.timestamp,
      actionId,
      actionKind,
      payloadJson: JSON.stringify(event),
      riskLevel,
      riskScore,
      riskFlagsJson,
    });

    if (riskScore !== null && riskScore > 0) {
      this.db
        .prepare(`UPDATE sessions SET risk_score = MAX(risk_score, ?) WHERE id = ?`)
        .run(riskScore, event.sessionId);
    }

    if (event.type === 'session.ended') {
      this.db
        .prepare(`
          UPDATE sessions 
          SET status = ?, ended_at = ?, summary_json = ?, risk_score = MAX(risk_score, ?) 
          WHERE id = ?
        `)
        .run(
          event.status,
          event.timestamp,
          JSON.stringify(event.summary),
          event.summary?.overallRiskScore || 0,
          event.sessionId
        );
    }
  }

  getEventsBySession(sessionId: string, afterSequence: number = 0): AgentEvent[] {
    const stmt = this.db.prepare(`
      SELECT payload_json FROM events
      WHERE session_id = ? AND sequence > ?
      ORDER BY sequence ASC
    `);
    const rows = stmt.all(sessionId, afterSequence) as any[];
    return rows.map((r) => JSON.parse(r.payload_json));
  }

  // ─────────────────────────────────────────────────────────────
  // Approval Persistence & Atomic Resolution (V0.2)
  // ─────────────────────────────────────────────────────────────

  createApproval(approval: ApprovalRequest): void {
    const stmt = this.db.prepare(`
      INSERT INTO approvals (
        id, action_id, session_id, action_kind, category, params_json,
        risk_score, risk_level, risk_flags_json, reason, matched_policies_json,
        status, resolved_by, created_at, resolved_at
      ) VALUES (
        @id, @actionId, @sessionId, @actionKind, @category, @paramsJson,
        @riskScore, @riskLevel, @riskFlagsJson, @reason, @matchedPoliciesJson,
        @status, @resolvedBy, @createdAt, @resolvedAt
      )
    `);

    stmt.run({
      id: approval.id,
      actionId: approval.actionId,
      sessionId: approval.sessionId,
      actionKind: approval.actionKind,
      category: approval.category,
      paramsJson: JSON.stringify(approval.params),
      riskScore: approval.risk.score,
      riskLevel: approval.risk.level,
      riskFlagsJson: JSON.stringify(approval.risk.flags),
      reason: approval.reason,
      matchedPoliciesJson: JSON.stringify(approval.matchedPolicies),
      status: approval.status,
      resolvedBy: approval.resolvedBy ?? null,
      createdAt: approval.createdAt,
      resolvedAt: approval.resolvedAt ?? null,
    });
  }

  getApproval(id: string): ApprovalRequest | null {
    const stmt = this.db.prepare(`SELECT * FROM approvals WHERE id = ?`);
    const row = stmt.get(id) as any;
    if (!row) return null;
    return this.mapApprovalRow(row);
  }

  getApprovalByActionId(actionId: string): ApprovalRequest | null {
    const stmt = this.db.prepare(`SELECT * FROM approvals WHERE action_id = ? ORDER BY created_at DESC LIMIT 1`);
    const row = stmt.get(actionId) as any;
    if (!row) return null;
    return this.mapApprovalRow(row);
  }

  listApprovals(sessionId?: string, status?: ApprovalStatus): ApprovalRequest[] {
    let query = `SELECT * FROM approvals`;
    const conditions: string[] = [];
    const params: any[] = [];

    if (sessionId) {
      conditions.push(`session_id = ?`);
      params.push(sessionId);
    }
    if (status) {
      conditions.push(`status = ?`);
      params.push(status);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ` ORDER BY created_at DESC`;

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as any[];
    return rows.map((r) => this.mapApprovalRow(r));
  }

  /**
   * Atomically resolves an approval request.
   * Uses atomic conditional update WHERE id = ? AND status = 'pending'.
   * Returns success: true only for the first valid resolution.
   */
  resolveApproval(
    id: string,
    decision: 'approved' | 'denied',
    resolvedBy: string = 'user'
  ): { success: boolean; approval: ApprovalRequest | null } {
    const stmt = this.db.prepare(`
      UPDATE approvals
      SET status = @decision,
          resolved_by = @resolvedBy,
          resolved_at = @resolvedAt
      WHERE id = @id
        AND status = 'pending'
    `);

    const result = stmt.run({
      id,
      decision,
      resolvedBy,
      resolvedAt: Date.now(),
    });

    const current = this.getApproval(id);
    return {
      success: result.changes > 0,
      approval: current,
    };
  }

  /**
   * Expires all pending approvals older than maxAgeMs.
   */
  expirePendingApprovals(maxAgeMs: number = 300000): ApprovalRequest[] {
    const cutoffTime = Date.now() - maxAgeMs;

    const findStmt = this.db.prepare(`
      SELECT id FROM approvals
      WHERE status = 'pending' AND created_at < ?
    `);
    const pendingExpired = findStmt.all(cutoffTime) as Array<{ id: string }>;

    if (pendingExpired.length === 0) return [];

    const expireStmt = this.db.prepare(`
      UPDATE approvals
      SET status = 'expired',
          resolved_by = 'timeout',
          resolved_at = @resolvedAt
      WHERE id = @id
        AND status = 'pending'
    `);

    const now = Date.now();
    const expiredList: ApprovalRequest[] = [];

    for (const item of pendingExpired) {
      const res = expireStmt.run({ id: item.id, resolvedAt: now });
      if (res.changes > 0) {
        const app = this.getApproval(item.id);
        if (app) expiredList.push(app);
      }
    }

    return expiredList;
  }

  private mapApprovalRow(row: any): ApprovalRequest {
    return {
      id: row.id,
      actionId: row.action_id,
      sessionId: row.session_id,
      actionKind: row.action_kind,
      category: row.category,
      params: JSON.parse(row.params_json),
      risk: {
        score: row.risk_score,
        level: row.risk_level,
        flags: JSON.parse(row.risk_flags_json || '[]'),
      },
      reason: row.reason,
      matchedPolicies: JSON.parse(row.matched_policies_json || '[]'),
      status: row.status,
      resolvedBy: row.resolved_by,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
    };
  }
}

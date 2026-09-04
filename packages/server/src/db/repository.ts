import { Database } from "better-sqlite3";
import {
  AgentEvent,
  AgentSession,
  ApprovalRequest,
  ApprovalStatus,
} from "@agent-monitor/core";

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

    if (status === "running") {
      const endedEventRow = this.db
        .prepare(
          `SELECT payload_json FROM events WHERE session_id = ? AND type = 'session.ended' LIMIT 1`,
        )
        .get(id) as any;

      if (endedEventRow) {
        const endedEvent = JSON.parse(endedEventRow.payload_json);
        status = endedEvent.status || "completed";
        endedAt = endedEvent.timestamp;
        summary = endedEvent.summary || summary;
        riskScore = Math.max(
          riskScore,
          endedEvent.summary?.overallRiskScore || 0,
        );

        this.db
          .prepare(
            `UPDATE sessions SET status = ?, ended_at = ?, summary_json = ?, risk_score = ? WHERE id = ?`,
          )
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
    const stmt = this.db.prepare(
      `SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?`,
    );
    const rows = stmt.all(limit) as any[];

    return rows.map((row) => {
      let status = row.status;
      let endedAt = row.ended_at;
      let summary = row.summary_json ? JSON.parse(row.summary_json) : null;
      let riskScore = row.risk_score;

      if (status === "running") {
        const endedEventRow = this.db
          .prepare(
            `SELECT payload_json FROM events WHERE session_id = ? AND type = 'session.ended' LIMIT 1`,
          )
          .get(row.id) as any;

        if (endedEventRow) {
          const endedEvent = JSON.parse(endedEventRow.payload_json);
          status = endedEvent.status || "completed";
          endedAt = endedEvent.timestamp;
          summary = endedEvent.summary || summary;
          riskScore = Math.max(
            riskScore,
            endedEvent.summary?.overallRiskScore || 0,
          );

          this.db
            .prepare(
              `UPDATE sessions SET status = ?, ended_at = ?, summary_json = ?, risk_score = ? WHERE id = ?`,
            )
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
      status?: AgentSession["status"];
      endedAt?: number;
      summary?: any;
      riskScore?: number;
    },
  ): void {
    const fields: string[] = [];
    const params: Record<string, any> = { id };

    if (updates.status !== undefined) {
      fields.push("status = @status");
      params.status = updates.status;
    }
    if (updates.endedAt !== undefined) {
      fields.push("ended_at = @endedAt");
      params.endedAt = updates.endedAt;
    }
    if (updates.summary !== undefined) {
      fields.push("summary_json = @summaryJson");
      params.summaryJson = JSON.stringify(updates.summary);
    }
    if (updates.riskScore !== undefined) {
      fields.push("risk_score = @riskScore");
      params.riskScore = updates.riskScore;
    }

    if (fields.length === 0) return;

    const stmt = this.db.prepare(
      `UPDATE sessions SET ${fields.join(", ")} WHERE id = @id`,
    );
    stmt.run(params);
  }

  getNextSequence(sessionId: string): number {
    const stmt = this.db.prepare(
      `SELECT MAX(sequence) as max_seq FROM events WHERE session_id = ?`,
    );
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

    if ("actionId" in event) {
      actionId = event.actionId;
    }
    if ("kind" in event) {
      actionKind = event.kind;
    }
    if ("risk" in event && event.risk) {
      riskLevel = event.risk.level;
      riskScore = event.risk.score;
      riskFlagsJson = JSON.stringify(event.risk.flags);
    }

    const sequence =
      typeof event.sequence === "number" && event.sequence > 0
        ? event.sequence
        : this.getNextSequence(event.sessionId);
    (event as any).sequence = sequence;

    stmt.run({
      id: event.id,
      sessionId: event.sessionId,
      sequence,
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
        .prepare(
          `UPDATE sessions SET risk_score = MAX(risk_score, ?) WHERE id = ?`,
        )
        .run(riskScore, event.sessionId);
    }

    if (event.type === "session.ended") {
      this.db
        .prepare(
          `
          UPDATE sessions 
          SET status = ?, ended_at = ?, summary_json = ?, risk_score = MAX(risk_score, ?) 
          WHERE id = ?
        `,
        )
        .run(
          event.status,
          event.timestamp,
          JSON.stringify(event.summary),
          event.summary?.overallRiskScore || 0,
          event.sessionId,
        );
    }
  }

  getEventsBySession(
    sessionId: string,
    afterSequence: number = 0,
  ): AgentEvent[] {
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
    const stmt = this.db.prepare(
      `SELECT * FROM approvals WHERE action_id = ? ORDER BY created_at DESC LIMIT 1`,
    );
    const row = stmt.get(actionId) as any;
    if (!row) return null;
    return this.mapApprovalRow(row);
  }

  listApprovals(
    sessionId?: string,
    status?: ApprovalStatus,
  ): ApprovalRequest[] {
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
      query += ` WHERE ${conditions.join(" AND ")}`;
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
    decision: "approved" | "denied",
    resolvedBy: string = "user",
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
        flags: JSON.parse(row.risk_flags_json || "[]"),
      },
      reason: row.reason,
      matchedPolicies: JSON.parse(row.matched_policies_json || "[]"),
      status: row.status,
      resolvedBy: row.resolved_by,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Tool Fingerprint Persistence (V0.3)
  // ─────────────────────────────────────────────────────────────

  recordToolFingerprint(record: {
    id: string;
    sessionId: string;
    toolName: string;
    source: string;
    fingerprint: string;
    schemaJson: string;
    description: string;
    firstSeenAt: number;
    lastSeenAt: number;
  }): {
    status: "TOOL_DISCOVERED" | "TOOL_UNCHANGED" | "TOOL_CHANGED";
    changeCount: number;
  } {
    const existing = this.db
      .prepare(
        `SELECT * FROM tool_fingerprints WHERE session_id = ? AND tool_name = ? AND source = ?`,
      )
      .get(record.sessionId, record.toolName, record.source) as any;

    if (!existing) {
      this.db
        .prepare(
          `
          INSERT INTO tool_fingerprints (
            id, session_id, tool_name, source, initial_fingerprint, fingerprint, schema_json, description, first_seen_at, last_seen_at, change_count
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        `,
        )
        .run(
          record.id,
          record.sessionId,
          record.toolName,
          record.source,
          record.fingerprint,
          record.fingerprint,
          record.schemaJson,
          record.description,
          record.firstSeenAt,
          record.lastSeenAt,
        );
      return { status: "TOOL_DISCOVERED", changeCount: 0 };
    }

    const baseline = existing.initial_fingerprint || existing.fingerprint;
    const isUnchangedFromBaseline = baseline === record.fingerprint;

    // Check if fingerprint changed since the last observation
    if (existing.fingerprint !== record.fingerprint) {
      const newChangeCount = (existing.change_count || 0) + 1;
      this.db
        .prepare(
          `
          UPDATE tool_fingerprints 
          SET fingerprint = ?, schema_json = ?, description = ?, last_seen_at = ?, change_count = ?
          WHERE id = ?
        `,
        )
        .run(
          record.fingerprint,
          record.schemaJson,
          record.description,
          record.lastSeenAt,
          newChangeCount,
          existing.id,
        );

      return {
        status: isUnchangedFromBaseline ? "TOOL_UNCHANGED" : "TOOL_CHANGED",
        changeCount: newChangeCount,
      };
    }

    // Fingerprint matches the most recent observation
    this.db
      .prepare(`UPDATE tool_fingerprints SET last_seen_at = ? WHERE id = ?`)
      .run(record.lastSeenAt, existing.id);

    return {
      status: isUnchangedFromBaseline ? "TOOL_UNCHANGED" : "TOOL_CHANGED",
      changeCount: existing.change_count || 0,
    };
  }

  getToolFingerprints(sessionId: string): any[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM tool_fingerprints WHERE session_id = ? ORDER BY tool_name ASC, source ASC`,
      )
      .all(sessionId) as any[];
    return rows.map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      toolName: r.tool_name,
      source: r.source,
      initialFingerprint: r.initial_fingerprint || r.fingerprint,
      fingerprint: r.fingerprint,
      schema: JSON.parse(r.schema_json || "{}"),
      description: r.description,
      firstSeenAt: r.first_seen_at,
      lastSeenAt: r.last_seen_at,
      changeCount: r.change_count,
    }));
  }

  isToolMutated(sessionId: string, toolName: string): boolean {
    const row = this.db
      .prepare(
        `SELECT initial_fingerprint, fingerprint, change_count FROM tool_fingerprints WHERE session_id = ? AND tool_name = ? LIMIT 1`,
      )
      .get(sessionId, toolName) as any;
    if (!row) return false;
    return (
      Boolean(row.change_count && row.change_count > 0) ||
      Boolean(
        row.initial_fingerprint && row.initial_fingerprint !== row.fingerprint,
      )
    );
  }

  // ─────────────────────────────────────────────────────────────
  // Behavioral Sequence Persistence (V0.3)
  // ─────────────────────────────────────────────────────────────

  recordBehavioralMatch(match: {
    id: string;
    sessionId: string;
    ruleId: string;
    name: string;
    severity: string;
    reason: string;
    triggeringActionId?: string;
    priorActionIds?: string[];
    createdAt: number;
  }): void {
    this.db
      .prepare(
        `
        INSERT INTO behavioral_matches (
          id, session_id, rule_id, name, severity, reason, triggering_action_id, prior_action_ids_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        match.id,
        match.sessionId,
        match.ruleId,
        match.name,
        match.severity,
        match.reason,
        match.triggeringActionId || null,
        JSON.stringify(match.priorActionIds || []),
        match.createdAt,
      );
  }

  getBehavioralMatches(sessionId: string): any[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM behavioral_matches WHERE session_id = ? ORDER BY created_at ASC`,
      )
      .all(sessionId) as any[];
    return rows.map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      ruleId: r.rule_id,
      name: r.name,
      severity: r.severity,
      reason: r.reason,
      triggeringActionId: r.triggering_action_id,
      priorActionIds: JSON.parse(r.prior_action_ids_json || "[]"),
      createdAt: r.created_at,
    }));
  }

  // ─────────────────────────────────────────────────────────────
  // Authoritative Kill Switch State (V0.3)
  // ─────────────────────────────────────────────────────────────

  setKillSwitch(
    sessionId: string,
    active: boolean,
    reason?: string,
    actor: string = "operator",
  ): void {
    const tx = this.db.transaction(() => {
      const now = Date.now();
      const existing = this.db
        .prepare(`SELECT session_id FROM control_state WHERE session_id = ?`)
        .get(sessionId) as any;

      if (!existing) {
        this.db
          .prepare(
            `
            INSERT INTO control_state (
              session_id, kill_switch_active, activated_at, activated_by, reason, resumed_at, resumed_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
          )
          .run(
            sessionId,
            active ? 1 : 0,
            active ? now : null,
            active ? actor : null,
            active ? reason || "Manual kill switch activation" : null,
            !active ? now : null,
            !active ? actor : null,
          );
      } else {
        if (active) {
          this.db
            .prepare(
              `
              UPDATE control_state
              SET kill_switch_active = 1,
                  activated_at = ?,
                  activated_by = ?,
                  reason = ?
              WHERE session_id = ?
            `,
            )
            .run(
              now,
              actor,
              reason || "Manual kill switch activation",
              sessionId,
            );
        } else {
          this.db
            .prepare(
              `
              UPDATE control_state
              SET kill_switch_active = 0,
                  resumed_at = ?,
                  resumed_by = ?
              WHERE session_id = ?
            `,
            )
            .run(now, actor, sessionId);
        }
      }

      if (active) {
        this.db
          .prepare(
            `UPDATE sessions SET status = 'killed' WHERE id = ? AND status = 'running'`,
          )
          .run(sessionId);
      } else {
        this.db
          .prepare(
            `UPDATE sessions SET status = 'running' WHERE id = ? AND status = 'killed'`,
          )
          .run(sessionId);
      }
    });

    tx();
  }

  isKillSwitchActive(sessionId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT kill_switch_active FROM control_state WHERE session_id = ?`,
      )
      .get(sessionId) as any;
    return row ? Boolean(row.kill_switch_active) : false;
  }

  getControlState(sessionId: string): {
    killSwitchActive: boolean;
    activatedAt?: number | null;
    activatedBy?: string | null;
    reason?: string | null;
    resumedAt?: number | null;
    resumedBy?: string | null;
  } {
    const row = this.db
      .prepare(`SELECT * FROM control_state WHERE session_id = ?`)
      .get(sessionId) as any;
    if (!row) {
      return { killSwitchActive: false };
    }
    return {
      killSwitchActive: Boolean(row.kill_switch_active),
      activatedAt: row.activated_at,
      activatedBy: row.activated_by,
      reason: row.reason,
      resumedAt: row.resumed_at,
      resumedBy: row.resumed_by,
    };
  }
}

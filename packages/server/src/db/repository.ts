import { Database } from "better-sqlite3";
import {
  AgentEvent,
  AgentSession,
  ApprovalRequest,
  ApprovalStatus,
  PolicyVersion,
  PolicyVersionDiff,
  PolicyMutationAudit,
  PolicyRule,
  PolicyDecision,
  computePolicyHash,
  diffPolicyVersions as coreDiffPolicyVersions,
  DEFAULT_POLICY_RULES,
  SecurityIncident,
  IncidentSeverity,
  IncidentStatus,
  IncidentTrigger,
  McpSourceRecord,
  McpSourceStatus,
  McpTrustState,
  computeEventHash,
  computeSourceFingerprint,
  computeToolSchemaFingerprint,
  exportCanonicalLedger,
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
        risk_level, risk_score, risk_flags_json,
        hash, prev_hash
      ) VALUES (
        @id, @sessionId, @sequence, @type, @timestamp,
        @actionId, @actionKind, @payloadJson,
        @riskLevel, @riskScore, @riskFlagsJson,
        @hash, @prevHash
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

    const prevHash =
      (event as any).prevHash !== undefined
        ? (event as any).prevHash
        : this.getLatestEventHash(event.sessionId);
    (event as any).prevHash = prevHash;

    const hash =
      (event as any).hash || computeEventHash(event as any, prevHash);
    (event as any).hash = hash;

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
      hash,
      prevHash,
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

  getEvents(sessionId: string): AgentEvent[] {
    return this.getEventsBySession(sessionId);
  }

  // ─────────────────────────────────────────────────────────────
  // Approval Persistence & Atomic Resolution (V0.2)
  // ─────────────────────────────────────────────────────────────

  createApproval(approval: ApprovalRequest): void {
    const stmt = this.db.prepare(`
      INSERT INTO approvals (
        id, action_id, session_id, action_kind, category, params_json,
        risk_score, risk_level, risk_flags_json, reason, matched_policies_json,
        status, resolved_by, created_at, resolved_at,
        policy_version, expires_at, action_context_hash
      ) VALUES (
        @id, @actionId, @sessionId, @actionKind, @category, @paramsJson,
        @riskScore, @riskLevel, @riskFlagsJson, @reason, @matchedPoliciesJson,
        @status, @resolvedBy, @createdAt, @resolvedAt,
        @policyVersion, @expiresAt, @actionContextHash
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
      policyVersion: approval.policyVersion ?? 1,
      expiresAt: approval.expiresAt ?? null,
      actionContextHash: approval.actionContextHash ?? null,
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
   * Checks kill switch and expiration before committing approval.
   * Uses atomic conditional update WHERE id = ? AND status = 'pending'.
   * Returns success: true only for the first valid resolution.
   */
  resolveApproval(
    id: string,
    decision: "approved" | "denied",
    resolvedBy: string = "user",
  ): { success: boolean; approval: ApprovalRequest | null } {
    const current = this.getApproval(id);
    if (!current) {
      return { success: false, approval: null };
    }

    if (current.status !== "pending") {
      return { success: false, approval: current };
    }

    const now = Date.now();

    // Check expiration
    if (current.expiresAt && now > current.expiresAt) {
      this.db
        .prepare(
          `UPDATE approvals SET status = 'expired', resolved_by = 'timeout', resolved_at = ? WHERE id = ? AND status = 'pending'`,
        )
        .run(now, id);
      return { success: false, approval: this.getApproval(id) };
    }

    // Check kill switch
    if (decision === "approved" && this.isKillSwitchActive(current.sessionId)) {
      this.db
        .prepare(
          `UPDATE approvals SET status = 'denied', resolved_by = 'kill_switch', resolved_at = ? WHERE id = ? AND status = 'pending'`,
        )
        .run(now, id);
      return { success: false, approval: this.getApproval(id) };
    }

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
      resolvedAt: now,
    });

    const updated = this.getApproval(id);
    return {
      success: result.changes > 0,
      approval: updated,
    };
  }

  /**
   * Expires all pending approvals older than maxAgeMs or past their expiresAt.
   */
  expirePendingApprovals(maxAgeMs: number = 300000): ApprovalRequest[] {
    const cutoffTime = Date.now() - maxAgeMs;
    const now = Date.now();

    const findStmt = this.db.prepare(`
      SELECT id FROM approvals
      WHERE status = 'pending' AND (created_at < ? OR (expires_at IS NOT NULL AND expires_at < ?))
    `);
    const pendingExpired = findStmt.all(cutoffTime, now) as Array<{
      id: string;
    }>;

    if (pendingExpired.length === 0) return [];

    const expireStmt = this.db.prepare(`
      UPDATE approvals
      SET status = 'expired',
          resolved_by = 'timeout',
          resolved_at = @resolvedAt
      WHERE id = @id
        AND status = 'pending'
    `);

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
      policyVersion: row.policy_version ?? 1,
      expiresAt: row.expires_at ?? undefined,
      actionContextHash: row.action_context_hash ?? undefined,
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

  isToolMutated(sessionId: string, toolName: string, source?: string): boolean {
    let query = `SELECT initial_fingerprint, fingerprint, change_count FROM tool_fingerprints WHERE session_id = ? AND tool_name = ?`;
    const params: any[] = [sessionId, toolName];
    if (source) {
      const altSource = source.startsWith("mcp:")
        ? source.replace(/^mcp:/, "")
        : `mcp:${source}`;
      query += ` AND (source = ? OR source = ?)`;
      params.push(source, altSource);
    }
    query += ` AND (change_count > 0 OR initial_fingerprint != fingerprint) LIMIT 1`;
    const row = this.db.prepare(query).get(...params) as any;
    return Boolean(row);
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

  // ─────────────────────────────────────────────────────────────
  // Event Audit Hash Chaining (V4)
  // ─────────────────────────────────────────────────────────────

  getLatestEventHash(sessionId: string): string | null {
    const row = this.db
      .prepare(
        `SELECT hash FROM events WHERE session_id = ? ORDER BY sequence DESC LIMIT 1`,
      )
      .get(sessionId) as any;
    return row?.hash ?? null;
  }

  // ─────────────────────────────────────────────────────────────
  // Policy Versioning & Management (V4)
  // ─────────────────────────────────────────────────────────────

  createPolicyVersion(params: {
    name: string;
    description?: string;
    rules: PolicyRule[];
    defaultDecision?: PolicyDecision;
    timeoutMs?: number;
    createdBy?: string;
    changeSummary?: string;
    activate?: boolean;
  }): PolicyVersion {
    const defaultDecision = params.defaultDecision || "ALLOW";
    const timeoutMs = params.timeoutMs || 300000;
    const createdBy = params.createdBy || "operator";
    const changeSummary = params.changeSummary || "Initial policy version";

    const hash = computePolicyHash(params.rules, defaultDecision, timeoutMs);

    const tx = this.db.transaction(() => {
      const maxRow = this.db
        .prepare(`SELECT MAX(version_number) as max_v FROM policy_versions`)
        .get() as any;
      const versionNumber = (maxRow?.max_v || 0) + 1;
      const id = `pol_v${versionNumber}_${Date.now().toString(36)}`;
      const now = Date.now();

      const shouldActivate =
        params.activate !== undefined ? params.activate : versionNumber === 1;

      if (shouldActivate) {
        this.db
          .prepare(
            `UPDATE policy_versions SET is_active = 0 WHERE is_active = 1`,
          )
          .run();
      }

      this.db
        .prepare(
          `
          INSERT INTO policy_versions (
            id, version_number, name, description, rules_json, default_decision,
            timeout_ms, is_active, created_at, created_by, change_summary, hash
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        )
        .run(
          id,
          versionNumber,
          params.name,
          params.description || null,
          JSON.stringify(params.rules),
          defaultDecision,
          timeoutMs,
          shouldActivate ? 1 : 0,
          now,
          createdBy,
          changeSummary,
          hash,
        );

      this.recordPolicyAudit({
        versionId: id,
        action: "created",
        actor: createdBy,
        details: { versionNumber, name: params.name, changeSummary },
      });

      if (shouldActivate) {
        this.recordPolicyAudit({
          versionId: id,
          action: "activated",
          actor: createdBy,
          details: { versionNumber, name: params.name },
        });
      }

      return {
        id,
        versionNumber,
        name: params.name,
        description: params.description,
        rules: params.rules,
        defaultDecision,
        timeoutMs,
        isActive: shouldActivate,
        createdAt: now,
        createdBy,
        changeSummary,
        hash,
      };
    });

    return tx();
  }

  getActivePolicyVersion(): PolicyVersion | null {
    const row = this.db
      .prepare(`SELECT * FROM policy_versions WHERE is_active = 1 LIMIT 1`)
      .get() as any;
    if (!row) return null;
    return this.mapPolicyVersionRow(row);
  }

  getPolicyVersion(versionNumberOrId: number | string): PolicyVersion | null {
    let row: any;
    if (typeof versionNumberOrId === "number") {
      row = this.db
        .prepare(`SELECT * FROM policy_versions WHERE version_number = ?`)
        .get(versionNumberOrId);
    } else {
      row = this.db
        .prepare(
          `SELECT * FROM policy_versions WHERE id = ? OR version_number = ?`,
        )
        .get(versionNumberOrId, Number(versionNumberOrId) || -1);
    }
    if (!row) return null;
    return this.mapPolicyVersionRow(row);
  }

  listPolicyVersions(): PolicyVersion[] {
    const rows = this.db
      .prepare(`SELECT * FROM policy_versions ORDER BY version_number DESC`)
      .all() as any[];
    return rows.map((r) => this.mapPolicyVersionRow(r));
  }

  activatePolicyVersion(
    versionNumberOrId: number | string,
    actor: string = "operator",
  ): PolicyVersion {
    const target = this.getPolicyVersion(versionNumberOrId);
    if (!target) {
      throw new Error(`Policy version '${versionNumberOrId}' not found`);
    }

    const tx = this.db.transaction(() => {
      this.db
        .prepare(`UPDATE policy_versions SET is_active = 0 WHERE is_active = 1`)
        .run();
      this.db
        .prepare(`UPDATE policy_versions SET is_active = 1 WHERE id = ?`)
        .run(target.id);

      this.recordPolicyAudit({
        versionId: target.id,
        action: "activated",
        actor,
        details: { versionNumber: target.versionNumber, name: target.name },
      });

      return {
        ...target,
        isActive: true,
      };
    });

    return tx();
  }

  rollbackPolicyVersion(
    targetVersionNumber: number,
    actor: string = "operator",
  ): PolicyVersion {
    const target = this.getPolicyVersion(targetVersionNumber);
    if (!target) {
      throw new Error(
        `Target policy version ${targetVersionNumber} not found for rollback`,
      );
    }

    return this.createPolicyVersion({
      name: `Rollback to v${targetVersionNumber} (${target.name})`,
      description: target.description,
      rules: target.rules,
      defaultDecision: target.defaultDecision,
      timeoutMs: target.timeoutMs,
      createdBy: actor,
      changeSummary: `Rollback to policy version ${targetVersionNumber}`,
      activate: true,
    });
  }

  diffPolicyVersions(versionA: number, versionB: number): PolicyVersionDiff {
    const vA = this.getPolicyVersion(versionA);
    const vB = this.getPolicyVersion(versionB);
    if (!vA) throw new Error(`Policy version ${versionA} not found`);
    if (!vB) throw new Error(`Policy version ${versionB} not found`);
    return coreDiffPolicyVersions(vA, vB);
  }

  togglePolicyRule(
    ruleId: string,
    enabled: boolean,
    actor: string = "operator",
  ): PolicyVersion {
    let active = this.getActivePolicyVersion();
    if (!active) {
      active = this.createPolicyVersion({
        name: "Baseline Policy",
        description: "Default baseline security policies",
        rules: DEFAULT_POLICY_RULES,
        defaultDecision: "ALLOW",
        createdBy: "system",
        changeSummary: "Automatic bootstrap from defaults",
        activate: true,
      });
    }

    const ruleExisted = active.rules.some((r) => r.id === ruleId);
    if (!ruleExisted) {
      throw new Error(`Rule '${ruleId}' not found in active policy version`);
    }

    const updatedRules = active.rules.map((r) => {
      if (r.id === ruleId) {
        return { ...r, enabled };
      }
      return r;
    });

    return this.createPolicyVersion({
      name: active.name,
      description: active.description,
      rules: updatedRules,
      defaultDecision: active.defaultDecision,
      timeoutMs: active.timeoutMs,
      createdBy: actor,
      changeSummary: `Toggled rule '${ruleId}' to ${enabled ? "enabled" : "disabled"}`,
      activate: true,
    });
  }

  recordPolicyAudit(audit: {
    versionId: string;
    action: PolicyMutationAudit["action"];
    actor: string;
    details: Record<string, any>;
  }): void {
    const id = `pa_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    this.db
      .prepare(
        `
        INSERT INTO policy_audit_log (id, version_id, action, actor, timestamp, details_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        id,
        audit.versionId,
        audit.action,
        audit.actor,
        Date.now(),
        JSON.stringify(audit.details),
      );
  }

  getPolicyAuditLog(limit: number = 50): PolicyMutationAudit[] {
    const rows = this.db
      .prepare(`SELECT * FROM policy_audit_log ORDER BY timestamp DESC LIMIT ?`)
      .all(limit) as any[];
    return rows.map((r) => ({
      id: r.id,
      versionId: r.version_id,
      action: r.action,
      actor: r.actor,
      timestamp: r.timestamp,
      details: JSON.parse(r.details_json || "{}"),
    }));
  }

  private mapPolicyVersionRow(row: any): PolicyVersion {
    return {
      id: row.id,
      versionNumber: row.version_number,
      name: row.name,
      description: row.description,
      rules: JSON.parse(row.rules_json || "[]"),
      defaultDecision: row.default_decision,
      timeoutMs: row.timeout_ms,
      isActive: Boolean(row.is_active),
      createdAt: row.created_at,
      createdBy: row.created_by,
      changeSummary: row.change_summary,
      hash: row.hash,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Security Incident Case Model (V4)
  // ─────────────────────────────────────────────────────────────

  createIncident(incident: {
    sessionId: string;
    severity: IncidentSeverity;
    triggerType: IncidentTrigger;
    title: string;
    description: string;
    triggerEventId?: string;
    relatedEventIds?: string[];
  }): SecurityIncident {
    const now = Date.now();
    const countRow = this.db
      .prepare(`SELECT COUNT(*) as count FROM incidents`)
      .get() as any;
    const num = (countRow?.count || 0) + 1;
    const incidentNumber = `INC-${String(num).padStart(5, "0")}`;
    const id = `inc_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;

    this.db
      .prepare(
        `
        INSERT INTO incidents (
          id, incident_number, session_id, severity, status, trigger_type,
          title, description, trigger_event_id, related_event_ids_json,
          created_at, updated_at, resolved_at, resolved_by, resolution_notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
      `,
      )
      .run(
        id,
        incidentNumber,
        incident.sessionId,
        incident.severity,
        "OPEN",
        incident.triggerType,
        incident.title,
        incident.description,
        incident.triggerEventId || null,
        JSON.stringify(incident.relatedEventIds || []),
        now,
        now,
      );

    return {
      id,
      incidentNumber,
      sessionId: incident.sessionId,
      severity: incident.severity,
      status: "OPEN",
      triggerType: incident.triggerType,
      title: incident.title,
      description: incident.description,
      triggerEventId: incident.triggerEventId,
      relatedEventIds: incident.relatedEventIds || [],
      createdAt: now,
      updatedAt: now,
    };
  }

  getIncident(id: string): SecurityIncident | null {
    const row = this.db
      .prepare(`SELECT * FROM incidents WHERE id = ? OR incident_number = ?`)
      .get(id, id) as any;
    if (!row) return null;
    return this.mapIncidentRow(row);
  }

  listIncidents(filters?: {
    sessionId?: string;
    status?: IncidentStatus;
    severity?: IncidentSeverity;
    limit?: number;
  }): SecurityIncident[] {
    let query = `SELECT * FROM incidents`;
    const conditions: string[] = [];
    const params: any[] = [];

    if (filters?.sessionId) {
      conditions.push(`session_id = ?`);
      params.push(filters.sessionId);
    }
    if (filters?.status) {
      conditions.push(`status = ?`);
      params.push(filters.status);
    }
    if (filters?.severity) {
      conditions.push(`severity = ?`);
      params.push(filters.severity);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(" AND ")}`;
    }

    query += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(filters?.limit || 50);

    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map((r) => this.mapIncidentRow(r));
  }

  updateIncident(
    id: string,
    updates: {
      status?: IncidentStatus;
      severity?: IncidentSeverity;
      resolvedBy?: string;
      resolutionNotes?: string;
    },
  ): SecurityIncident | null {
    const existing = this.getIncident(id);
    if (!existing) return null;

    const fields: string[] = ["updated_at = ?"];
    const params: any[] = [Date.now()];

    if (updates.status !== undefined) {
      fields.push("status = ?");
      params.push(updates.status);
      if (
        updates.status === "RESOLVED" ||
        updates.status === "FALSE_POSITIVE"
      ) {
        fields.push("resolved_at = ?");
        params.push(Date.now());
      }
    }
    if (updates.severity !== undefined) {
      fields.push("severity = ?");
      params.push(updates.severity);
    }
    if (updates.resolvedBy !== undefined) {
      fields.push("resolved_by = ?");
      params.push(updates.resolvedBy);
    }
    if (updates.resolutionNotes !== undefined) {
      fields.push("resolution_notes = ?");
      params.push(updates.resolutionNotes);
    }

    params.push(existing.id);

    this.db
      .prepare(`UPDATE incidents SET ${fields.join(", ")} WHERE id = ?`)
      .run(...params);

    return this.getIncident(existing.id);
  }

  getIncidentEvents(incidentId: string): AgentEvent[] {
    const incident = this.getIncident(incidentId);
    if (!incident) return [];

    const eventIds = new Set<string>();
    if (incident.triggerEventId) {
      eventIds.add(incident.triggerEventId);
    }
    for (const eid of incident.relatedEventIds) {
      eventIds.add(eid);
    }

    if (eventIds.size === 0) return [];

    const placeholders = Array.from(eventIds)
      .map(() => "?")
      .join(", ");
    const rows = this.db
      .prepare(
        `SELECT payload_json FROM events WHERE id IN (${placeholders}) ORDER BY sequence ASC`,
      )
      .all(...Array.from(eventIds)) as any[];

    return rows.map((r) => JSON.parse(r.payload_json));
  }

  private mapIncidentRow(row: any): SecurityIncident {
    return {
      id: row.id,
      incidentNumber: row.incident_number,
      sessionId: row.session_id,
      severity: row.severity,
      status: row.status,
      triggerType: row.trigger_type,
      title: row.title,
      description: row.description,
      triggerEventId: row.trigger_event_id || undefined,
      relatedEventIds: JSON.parse(row.related_event_ids_json || "[]"),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      resolvedAt: row.resolved_at || undefined,
      resolvedBy: row.resolved_by || undefined,
      resolutionNotes: row.resolution_notes || undefined,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // MCP Source Registry & Quarantine (V4)
  // ─────────────────────────────────────────────────────────────

  upsertMcpSource(source: {
    sourceId: string;
    name: string;
    command: string;
    args: string[];
    env?: Record<string, string>;
    cwd?: string;
    transport?: string;
    fingerprint?: string;
    toolSchemaFingerprint?: string;
    retrustRequired?: boolean;
    status?: McpSourceStatus;
    pid?: number | null;
    trustState?: McpTrustState;
  }): McpSourceRecord {
    const now = Date.now();
    const existing = this.getMcpSource(source.sourceId);

    const transport = source.transport || existing?.transport || "stdio";
    const fingerprint =
      source.fingerprint ||
      computeSourceFingerprint({
        command: source.command,
        args: source.args,
        cwd: source.cwd,
        transport,
      });

    if (!existing) {
      this.db
        .prepare(
          `
          INSERT INTO mcp_sources (
            source_id, name, command, args_json, env_json, cwd, status,
            pid, start_time, restart_count, consecutive_failures, last_seen,
            tool_count, trust_state, transport, fingerprint,
            tool_schema_fingerprint, retrust_required
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 0, ?, ?, ?, ?, ?)
        `,
        )
        .run(
          source.sourceId,
          source.name,
          source.command,
          JSON.stringify(source.args),
          source.env ? JSON.stringify(source.env) : null,
          source.cwd || null,
          source.status || "HEALTHY",
          source.pid || null,
          source.pid ? now : null,
          now,
          source.trustState || "TRUSTED",
          transport,
          fingerprint,
          source.toolSchemaFingerprint || null,
          source.retrustRequired ? 1 : 0,
        );
    } else {
      let retrustRequired = existing.retrustRequired ? 1 : 0;
      let nextTrustState = source.trustState || existing.trustState;

      // Mutation detection: if command or args or path changed
      if (existing.fingerprint && existing.fingerprint !== fingerprint) {
        retrustRequired = 1;
        nextTrustState = "UNTRUSTED";
      }

      if (
        source.toolSchemaFingerprint &&
        existing.toolSchemaFingerprint &&
        existing.toolSchemaFingerprint !== source.toolSchemaFingerprint
      ) {
        retrustRequired = 1;
        nextTrustState = "UNTRUSTED";
      }

      const nextStatus =
        existing.status === "QUARANTINED"
          ? "QUARANTINED"
          : source.status || existing.status;

      this.db
        .prepare(
          `
          UPDATE mcp_sources
          SET name = ?, command = ?, args_json = ?, env_json = ?, cwd = ?,
              status = ?, pid = ?, last_seen = ?, transport = ?,
              fingerprint = ?, tool_schema_fingerprint = COALESCE(?, tool_schema_fingerprint),
              retrust_required = ?, trust_state = ?
          WHERE source_id = ?
        `,
        )
        .run(
          source.name,
          source.command,
          JSON.stringify(source.args),
          source.env ? JSON.stringify(source.env) : null,
          source.cwd || null,
          nextStatus,
          source.pid || null,
          now,
          transport,
          fingerprint,
          source.toolSchemaFingerprint || null,
          retrustRequired,
          nextTrustState,
          source.sourceId,
        );
    }

    return this.getMcpSource(source.sourceId)!;
  }

  getMcpSource(sourceId: string): McpSourceRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM mcp_sources WHERE source_id = ?`)
      .get(sourceId) as any;
    if (!row) return null;
    return this.mapMcpSourceRow(row);
  }

  listMcpSources(): McpSourceRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM mcp_sources ORDER BY last_seen DESC`)
      .all() as any[];
    return rows.map((r) => this.mapMcpSourceRow(r));
  }

  quarantineMcpSource(
    sourceId: string,
    reason: string,
    quarantinedBy: string = "operator",
  ): McpSourceRecord {
    const now = Date.now();
    this.db
      .prepare(
        `
        UPDATE mcp_sources
        SET status = 'QUARANTINED',
            quarantined_at = ?,
            quarantined_by = ?,
            quarantine_reason = ?
        WHERE source_id = ?
      `,
      )
      .run(now, quarantinedBy, reason, sourceId);

    const updated = this.getMcpSource(sourceId);
    if (!updated) {
      throw new Error(`MCP source '${sourceId}' not found for quarantine`);
    }
    return updated;
  }

  trustMcpSource(sourceId: string): McpSourceRecord {
    this.db
      .prepare(
        `
        UPDATE mcp_sources
        SET status = 'HEALTHY',
            quarantined_at = NULL,
            quarantined_by = NULL,
            quarantine_reason = NULL,
            consecutive_failures = 0,
            trust_state = 'TRUSTED',
            retrust_required = 0
        WHERE source_id = ?
      `,
      )
      .run(sourceId);

    const updated = this.getMcpSource(sourceId);
    if (!updated) {
      throw new Error(`MCP source '${sourceId}' not found to trust`);
    }
    return updated;
  }

  quarantineSource(
    sourceId: string,
    reason: string,
    quarantinedBy: string = "operator",
  ): McpSourceRecord {
    return this.quarantineMcpSource(sourceId, reason, quarantinedBy);
  }

  trustSource(sourceId: string): McpSourceRecord {
    return this.trustMcpSource(sourceId);
  }

  isSourceQuarantined(sourceId: string): boolean {
    const normalized = sourceId.startsWith("mcp:")
      ? sourceId
      : `mcp:${sourceId}`;
    const alt = sourceId.replace(/^mcp:/, "");

    const row = this.db
      .prepare(
        `SELECT status FROM mcp_sources WHERE source_id = ? OR source_id = ? OR name = ?`,
      )
      .get(normalized, alt, alt) as any;

    return row?.status === "QUARANTINED";
  }

  recordSourceHealth(
    sourceId: string,
    health: {
      crashed?: boolean;
      failed?: boolean;
      toolCount?: number;
      pid?: number | null;
    },
  ): McpSourceRecord | null {
    const source = this.getMcpSource(sourceId);
    if (!source) return null;

    let consecutiveFailures = source.consecutiveFailures;
    let restartCount = source.restartCount;
    let status = source.status;

    if (health.crashed || health.failed) {
      consecutiveFailures++;
      if (health.crashed) restartCount++;
      if (consecutiveFailures >= 3 && status !== "QUARANTINED") {
        status = "QUARANTINED";
      } else if (status !== "QUARANTINED") {
        status = health.crashed ? "CRASHED" : "DEGRADED";
      }
    } else {
      consecutiveFailures = 0;
      if (status !== "QUARANTINED") {
        status = "HEALTHY";
      }
    }

    this.db
      .prepare(
        `
        UPDATE mcp_sources
        SET consecutive_failures = ?,
            restart_count = ?,
            status = ?,
            pid = COALESCE(?, pid),
            tool_count = COALESCE(?, tool_count),
            last_seen = ?
        WHERE source_id = ?
      `,
      )
      .run(
        consecutiveFailures,
        restartCount,
        status,
        health.pid !== undefined ? health.pid : null,
        health.toolCount !== undefined ? health.toolCount : null,
        Date.now(),
        source.sourceId,
      );

    return this.getMcpSource(source.sourceId);
  }

  exportLedger(sessionId?: string): string {
    const events = sessionId
      ? this.getEventsBySession(sessionId)
      : (
          this.db
            .prepare("SELECT payload_json FROM events ORDER BY sequence ASC")
            .all() as any[]
        ).map((r) => JSON.parse(r.payload_json));

    return exportCanonicalLedger(events, { sessionId });
  }

  private mapMcpSourceRow(row: any): McpSourceRecord {
    return {
      sourceId: row.source_id,
      name: row.name,
      command: row.command,
      args: JSON.parse(row.args_json || "[]"),
      env: row.env_json ? JSON.parse(row.env_json) : undefined,
      cwd: row.cwd || undefined,
      status: row.status,
      pid: row.pid,
      startTime: row.start_time,
      restartCount: row.restart_count,
      consecutiveFailures: row.consecutive_failures,
      lastSeen: row.last_seen,
      toolCount: row.tool_count,
      quarantinedAt: row.quarantined_at,
      quarantinedBy: row.quarantined_by,
      quarantineReason: row.quarantine_reason,
      trustState: row.trust_state,
      transport: row.transport || "stdio",
      fingerprint: row.fingerprint || undefined,
      toolSchemaFingerprint: row.tool_schema_fingerprint || undefined,
      retrustRequired: Boolean(row.retrust_required),
    };
  }

  // ─────────────────────────────────────────────────────────────

  // Idempotency & Request Correlation (V4)
  // ─────────────────────────────────────────────────────────────

  checkOrRecordIdempotency(record: {
    key: string;
    sessionId: string;
    actionKind: string;
    params: Record<string, any>;
  }): { isDuplicate: boolean; existingResult?: any } {
    const existing = this.db
      .prepare(`SELECT * FROM idempotency_records WHERE key = ?`)
      .get(record.key) as any;

    if (existing) {
      return {
        isDuplicate: true,
        existingResult: existing.result_json
          ? JSON.parse(existing.result_json)
          : undefined,
      };
    }

    const paramsHash = computePolicyHash([], "ALLOW", 0);

    this.db
      .prepare(
        `
        INSERT INTO idempotency_records (key, session_id, action_kind, request_params_hash, created_at, result_json)
        VALUES (?, ?, ?, ?, ?, NULL)
      `,
      )
      .run(
        record.key,
        record.sessionId,
        record.actionKind,
        paramsHash,
        Date.now(),
      );

    return { isDuplicate: false };
  }

  saveIdempotencyResult(key: string, result: any): void {
    this.db
      .prepare(`UPDATE idempotency_records SET result_json = ? WHERE key = ?`)
      .run(JSON.stringify(result), key);
  }

  // ─────────────────────────────────────────────────────────────
  // Security Event Investigation Query Engine (V4)
  // ─────────────────────────────────────────────────────────────

  queryEvents(filters: {
    sessionId?: string;
    type?: string;
    toolName?: string;
    source?: string;
    riskLevel?: string;
    decision?: string;
    since?: number;
    until?: number;
    limit?: number;
    offset?: number;
  }): AgentEvent[] {
    let query = `SELECT payload_json FROM events`;
    const conditions: string[] = [];
    const params: any[] = [];

    if (filters.sessionId) {
      conditions.push(`session_id = ?`);
      params.push(filters.sessionId);
    }
    if (filters.type) {
      conditions.push(`type = ?`);
      params.push(filters.type);
    }
    if (filters.toolName) {
      conditions.push(`action_kind = ?`);
      params.push(filters.toolName);
    }
    if (filters.riskLevel) {
      conditions.push(`risk_level = ?`);
      params.push(filters.riskLevel.toUpperCase());
    }
    if (filters.since) {
      conditions.push(`timestamp >= ?`);
      params.push(filters.since);
    }
    if (filters.until) {
      conditions.push(`timestamp <= ?`);
      params.push(filters.until);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(" AND ")}`;
    }

    query += ` ORDER BY timestamp ASC, sequence ASC LIMIT ? OFFSET ?`;
    params.push(Math.min(filters.limit || 100, 1000));
    params.push(filters.offset || 0);

    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map((r) => JSON.parse(r.payload_json));
  }
}

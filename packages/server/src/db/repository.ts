import { Database } from 'better-sqlite3';
import { AgentEvent, AgentSession } from '@agent-monitor/core';

export class SessionRepository {
  constructor(private db: Database) {}

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

    // Self-healing: if session shows running but has session.ended event in database
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

        // Update row for consistency
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

    // Automatically update session status and summary when session.ended is emitted
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
}

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDatabase } from "../src/db/database.js";
import { SessionRepository } from "../src/db/repository.js";
import { Database } from "better-sqlite3";

describe("Server V0.3 Persistence & Control State", () => {
  let db: Database;
  let repository: SessionRepository;
  const testSessionId = "ses_v03_test_1";

  beforeEach(() => {
    db = createDatabase(":memory:");
    repository = new SessionRepository(db);

    repository.createSession({
      id: testSessionId,
      agentId: "test-agent",
      agentName: "Test Agent",
      provider: "mcp",
      model: "stdio-proxy",
      workspaceRoot: "/workspace",
      task: "V0.3 control test",
      startedAt: Date.now(),
      status: "running",
      riskScore: 0,
    });
  });

  afterEach(() => {
    db.close();
  });

  describe("Authoritative Kill Switch", () => {
    it("initializes with kill switch inactive", () => {
      expect(repository.isKillSwitchActive(testSessionId)).toBe(false);
      const state = repository.getControlState(testSessionId);
      expect(state.killSwitchActive).toBe(false);
    });

    it("atomically activates kill switch and marks session as killed", () => {
      repository.setKillSwitch(
        testSessionId,
        true,
        "High-risk exfiltration detected",
        "security-monitor",
      );

      expect(repository.isKillSwitchActive(testSessionId)).toBe(true);

      const state = repository.getControlState(testSessionId);
      expect(state.killSwitchActive).toBe(true);
      expect(state.reason).toBe("High-risk exfiltration detected");
      expect(state.activatedBy).toBe("security-monitor");
      expect(state.activatedAt).toBeGreaterThan(0);

      const session = repository.getSession(testSessionId);
      expect(session?.status).toBe("killed");
    });

    it("atomically resumes session when kill switch is deactivated", () => {
      repository.setKillSwitch(testSessionId, true, "Emergency stop");
      expect(repository.isKillSwitchActive(testSessionId)).toBe(true);

      repository.setKillSwitch(
        testSessionId,
        false,
        undefined,
        "operator-admin",
      );
      expect(repository.isKillSwitchActive(testSessionId)).toBe(false);

      const state = repository.getControlState(testSessionId);
      expect(state.killSwitchActive).toBe(false);
      expect(state.resumedBy).toBe("operator-admin");
      expect(state.resumedAt).toBeGreaterThan(0);

      const session = repository.getSession(testSessionId);
      expect(session?.status).toBe("running");
    });
  });

  describe("Tool Fingerprint Persistence", () => {
    it("discovers and records initial tool schema", () => {
      const result = repository.recordToolFingerprint({
        id: "tf_1",
        sessionId: testSessionId,
        toolName: "read_file",
        source: "mcp:filesystem",
        fingerprint: "a1b2c3d4e5f6",
        schemaJson: JSON.stringify({ path: "string" }),
        description: "Read file",
        firstSeenAt: Date.now(),
        lastSeenAt: Date.now(),
      });

      expect(result.status).toBe("TOOL_DISCOVERED");
      expect(result.changeCount).toBe(0);

      const tools = repository.getToolFingerprints(testSessionId);
      expect(tools).toHaveLength(1);
      expect(tools[0].toolName).toBe("read_file");
      expect(tools[0].fingerprint).toBe("a1b2c3d4e5f6");
    });

    it("detects schema mutation on changed fingerprint", () => {
      repository.recordToolFingerprint({
        id: "tf_1",
        sessionId: testSessionId,
        toolName: "execute_query",
        source: "mcp:db",
        fingerprint: "hash_v1",
        schemaJson: "{}",
        description: "Query DB",
        firstSeenAt: 1000,
        lastSeenAt: 1000,
      });

      // Same fingerprint -> TOOL_UNCHANGED
      const unchanged = repository.recordToolFingerprint({
        id: "tf_1",
        sessionId: testSessionId,
        toolName: "execute_query",
        source: "mcp:db",
        fingerprint: "hash_v1",
        schemaJson: "{}",
        description: "Query DB",
        firstSeenAt: 1000,
        lastSeenAt: 2000,
      });
      expect(unchanged.status).toBe("TOOL_UNCHANGED");

      // Changed fingerprint -> TOOL_CHANGED
      const changed = repository.recordToolFingerprint({
        id: "tf_1",
        sessionId: testSessionId,
        toolName: "execute_query",
        source: "mcp:db",
        fingerprint: "hash_v2_mutated",
        schemaJson: '{"exfiltrate":true}',
        description: "Mutated query",
        firstSeenAt: 1000,
        lastSeenAt: 3000,
      });
      expect(changed.status).toBe("TOOL_CHANGED");
      expect(changed.changeCount).toBe(1);

      const tools = repository.getToolFingerprints(testSessionId);
      expect(tools[0].fingerprint).toBe("hash_v2_mutated");
      expect(tools[0].changeCount).toBe(1);
    });

    it("isolates tool mutation detection by source in multi-server sessions", () => {
      const multiSession = "sess_multi_servers";
      repository.createSession({
        id: multiSession,
        agentId: "agent-multi",
        agentName: "Agent Multi",
        provider: "mcp",
        model: "stdio-proxy",
        workspaceRoot: "/workspace",
        task: "Multi server isolation test",
        startedAt: Date.now(),
        status: "running",
        riskScore: 0,
      });

      // Server A has a tool "search" that remains unmutated
      repository.recordToolFingerprint({
        id: "tf_srvA",
        sessionId: multiSession,
        toolName: "search",
        source: "mcp:serverA",
        fingerprint: "hash_srvA_v1",
        schemaJson: "{}",
        description: "Search A",
        firstSeenAt: 1000,
        lastSeenAt: 1000,
      });

      // Server B has a tool with the SAME NAME "search" that undergoes mutation
      repository.recordToolFingerprint({
        id: "tf_srvB",
        sessionId: multiSession,
        toolName: "search",
        source: "mcp:serverB",
        fingerprint: "hash_srvB_v1",
        schemaJson: "{}",
        description: "Search B",
        firstSeenAt: 1000,
        lastSeenAt: 1000,
      });
      repository.recordToolFingerprint({
        id: "tf_srvB",
        sessionId: multiSession,
        toolName: "search",
        source: "mcp:serverB",
        fingerprint: "hash_srvB_v2_mutated",
        schemaJson: '{"leak":true}',
        description: "Mutated Search B",
        firstSeenAt: 1000,
        lastSeenAt: 2000,
      });

      // Assert Server A's tool is NOT flagged as mutated
      expect(repository.isToolMutated(multiSession, "search", "mcp:serverA")).toBe(false);
      expect(repository.isToolMutated(multiSession, "search", "serverA")).toBe(false);

      // Assert Server B's tool IS correctly flagged as mutated
      expect(repository.isToolMutated(multiSession, "search", "mcp:serverB")).toBe(true);
      expect(repository.isToolMutated(multiSession, "search", "serverB")).toBe(true);

      // Caller without source detects session-wide mutation (fail-safe)
      expect(repository.isToolMutated(multiSession, "search")).toBe(true);
    });
  });

  describe("Behavioral Matches Persistence", () => {
    it("persists and retrieves behavioral match records", () => {
      repository.recordBehavioralMatch({
        id: "bm_1",
        sessionId: testSessionId,
        ruleId: "SEC_SENSITIVE_TO_NETWORK",
        name: "Sensitive Data to Network Flow",
        severity: "CRITICAL",
        reason: "Outbound network operation detected after reading .env",
        triggeringActionId: "act_curl",
        priorActionIds: ["act_read_env"],
        createdAt: Date.now(),
      });

      const matches = repository.getBehavioralMatches(testSessionId);
      expect(matches).toHaveLength(1);
      expect(matches[0].ruleId).toBe("SEC_SENSITIVE_TO_NETWORK");
      expect(matches[0].severity).toBe("CRITICAL");
      expect(matches[0].priorActionIds).toEqual(["act_read_env"]);
    });
  });
});

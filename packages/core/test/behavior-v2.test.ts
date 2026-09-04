import { describe, it, expect } from "vitest";
import { BehavioralEngine } from "../src/index.js";

describe("Behavioral Security Engine V2 Multi-Step Rules", () => {
  it("detects sensitive credential read following tool mutation (SEC_MUTATION_TO_READ)", () => {
    const engine = new BehavioralEngine();
    const sessionId = "ses_behavior_mutation";

    // 1. Tool definition mutation occurs
    engine.recordToolMutation(sessionId, {
      actionId: "evt_mutation_1",
      toolName: "filesystem_tools",
    });

    // 2. Incoming sensitive read of service account credentials
    const matches = engine.evaluate(sessionId, {
      actionId: "act_read_cred",
      kind: "file.read",
      params: { path: "/app/config/service-account.json" },
    });

    const mutationMatch = matches.find(
      (m) => m.ruleId === "SEC_MUTATION_TO_READ",
    );
    expect(mutationMatch).toBeDefined();
    expect(mutationMatch?.severity).toBe("CRITICAL");
    expect(mutationMatch?.reason).toContain(
      "Sensitive credential read detected (/app/config/service-account.json) following tool schema mutation of 'filesystem_tools'",
    );
    expect(mutationMatch?.priorActionIds).toContain("evt_mutation_1");
  });

  it("detects command execution following blocked workspace traversal (SEC_TRAVERSAL_TO_EXEC)", () => {
    const engine = new BehavioralEngine();
    const sessionId = "ses_behavior_traversal";

    // 1. Workspace traversal attempt blocked
    engine.recordBlockedAction(sessionId, {
      actionId: "act_blocked_1",
      kind: "file.read",
      reason:
        "Blocked by security policy: Path escapes workspace root (path traversal)",
    });

    // 2. Next action attempts shell command execution
    const matches = engine.evaluate(sessionId, {
      actionId: "act_shell_exec",
      kind: "process.exec",
      params: { command: "whoami && cat /etc/passwd" },
    });

    const traversalMatch = matches.find(
      (m) => m.ruleId === "SEC_TRAVERSAL_TO_EXEC",
    );
    expect(traversalMatch).toBeDefined();
    expect(traversalMatch?.severity).toBe("HIGH");
    expect(traversalMatch?.reason).toContain(
      "Command execution detected following blocked workspace traversal",
    );
    expect(traversalMatch?.priorActionIds).toContain("act_blocked_1");
  });

  it("detects alternative tool probing following repeated policy denials (SEC_DENIAL_TO_ALTERNATIVE)", () => {
    const engine = new BehavioralEngine();
    const sessionId = "ses_behavior_probe";

    // 1. Two repeated denials on file.write
    engine.recordBlockedAction(sessionId, {
      actionId: "act_deny_1",
      kind: "file.write",
      reason: "Write denied by policy",
    });
    engine.recordBlockedAction(sessionId, {
      actionId: "act_deny_2",
      kind: "file.write",
      reason: "Write denied by policy",
    });

    // 2. Probing a completely different action kind: process.exec
    const matches = engine.evaluate(sessionId, {
      actionId: "act_probe_exec",
      kind: "process.exec",
      params: { command: "echo test" },
    });

    const probeMatch = matches.find(
      (m) => m.ruleId === "SEC_DENIAL_TO_ALTERNATIVE",
    );
    expect(probeMatch).toBeDefined();
    expect(probeMatch?.severity).toBe("HIGH");
    expect(probeMatch?.reason).toContain(
      "Probing alternative action 'process.exec' after 2 policy denials",
    );
    expect(probeMatch?.priorActionIds).toHaveLength(2);
  });

  it("reconstructs V2 behavioral state from historical events across restarts", () => {
    const engine = new BehavioralEngine();
    const sessionId = "ses_reconstruct_v2";

    const historicalEvents = [
      {
        type: "tool.changed",
        id: "evt_tc_1",
        toolName: "dynamic_shell",
        timestamp: 1000,
      },
      {
        type: "action.blocked",
        actionId: "act_block_1",
        kind: "file.read",
        reason: "Workspace boundary violation (traversal detected)",
        timestamp: 1050,
      },
    ];

    engine.reconstructFromEvents(sessionId, historicalEvents);

    const ctx = engine.getContext(sessionId);
    expect(ctx.mutatedTools).toHaveLength(1);
    expect(ctx.blockedActions).toHaveLength(1);

    // Verify evaluation leverages rehydrated state
    const matches = engine.evaluate(sessionId, {
      actionId: "act_read_env",
      kind: "file.read",
      params: { path: ".env" },
    });

    const mutationMatch = matches.find(
      (m) => m.ruleId === "SEC_MUTATION_TO_READ",
    );
    expect(mutationMatch).toBeDefined();
    expect(mutationMatch?.severity).toBe("CRITICAL");
  });
});

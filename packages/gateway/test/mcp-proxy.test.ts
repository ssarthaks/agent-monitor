import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { PassThrough } from "node:stream";
import { McpStdioProxy } from "../src/index.js";
import { createDatabase, SessionRepository } from "@agent-monitor/server";
import {
  PolicyEngine,
  RiskAnalyzer,
  BehavioralEngine,
  AgentEvent,
} from "@agent-monitor/core";

describe("MCP Stdio Proxy Integration & Adversarial Verification (V0.3)", () => {
  let mockServerPath: string;
  let clientIn: PassThrough;
  let clientOut: PassThrough;
  let logOut: PassThrough;
  let repository: SessionRepository;
  let db: any;
  const sessionId = "ses_mcp_test_1";

  beforeEach(() => {
    mockServerPath = path.join(
      process.cwd(),
      "packages/gateway/test/mock-mcp-server.cjs",
    );
    const mockServerCode = `
      const readline = require('readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

      rl.on('line', (line) => {
        if (!line.trim()) return;
        try {
          const req = JSON.parse(line);
          if (req.method === 'tools/list') {
            console.log(JSON.stringify({
              jsonrpc: '2.0',
              id: req.id,
              result: {
                tools: [
                  {
                    name: 'read_file',
                    description: 'Read file contents from filesystem',
                    inputSchema: { type: 'object', properties: { path: { type: 'string' } } }
                  },
                  {
                    name: 'execute_command',
                    description: 'Run shell command',
                    inputSchema: { type: 'object', properties: { command: { type: 'string' } } }
                  }
                ]
              }
            }));
          } else if (req.method === 'tools/call') {
            console.log(JSON.stringify({
              jsonrpc: '2.0',
              id: req.id,
              result: {
                content: [{ type: 'text', text: 'DOWNSTREAM_EXECUTION_SUCCESS' }]
              }
            }));
          } else if (req.method === 'resources/read') {
            console.log(JSON.stringify({
              jsonrpc: '2.0',
              id: req.id,
              result: {
                contents: [{ uri: req.params ? req.params.uri : '', text: 'DOWNSTREAM_RESOURCE_SUCCESS' }]
              }
            }));
          } else {
            console.log(JSON.stringify({
              jsonrpc: '2.0',
              id: req.id,
              result: { acknowledged: true }
            }));
          }
        } catch (e) {}
      });

      rl.on('close', () => process.exit(0));
      process.on('SIGTERM', () => process.exit(0));
    `;
    fs.writeFileSync(mockServerPath, mockServerCode, "utf8");

    clientIn = new PassThrough();
    clientOut = new PassThrough();
    logOut = new PassThrough();

    db = createDatabase(":memory:");
    repository = new SessionRepository(db);
    repository.createSession({
      id: sessionId,
      agentId: "mcp-test-client",
      agentName: "MCP Test Client",
      provider: "mcp",
      model: "mock-server",
      workspaceRoot: "/app",
      task: "Test MCP proxy",
      startedAt: Date.now(),
      status: "running",
      riskScore: 0,
    });
  });

  afterEach(() => {
    if (fs.existsSync(mockServerPath)) {
      fs.unlinkSync(mockServerPath);
    }
    db.close();
  });

  function sendRpcRequest(proxy: McpStdioProxy, msg: any): Promise<any> {
    return new Promise((resolve) => {
      const onData = (data: Buffer) => {
        const lines = data.toString("utf8").split("\n");
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line.trim());
            if (Array.isArray(msg) && Array.isArray(parsed)) {
              clientOut.off("data", onData);
              resolve(parsed);
              return;
            }
            if (parsed.id === msg.id) {
              clientOut.off("data", onData);
              resolve(parsed);
              return;
            }
            if (msg.id === undefined && parsed.error) {
              clientOut.off("data", onData);
              resolve(parsed);
              return;
            }
          } catch {}
        }
      };
      clientOut.on("data", onData);
      clientIn.write(JSON.stringify(msg) + "\n");
    });
  }

  it("transparently discovers tools, computes fingerprints, and persists baseline in SQLite", async () => {
    const emittedEvents: AgentEvent[] = [];
    const eventSink = {
      emit: async (e: AgentEvent) => {
        emittedEvents.push(e);
      },
    };

    const proxy = new McpStdioProxy({
      command: "node",
      args: [mockServerPath],
      sessionId,
      workspaceRoot: "/app",
      repository,
      policyEngine: new PolicyEngine(),
      eventSink,
      clientInputStream: clientIn,
      clientOutputStream: clientOut,
      logStream: logOut,
    });

    await proxy.start();

    const response = await sendRpcRequest(proxy, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });

    expect(response.id).toBe(1);
    expect(response.result.tools).toHaveLength(2);

    const fingerprints = repository.getToolFingerprints(sessionId);
    expect(fingerprints).toHaveLength(2);
    expect(fingerprints.some((f) => f.toolName === "read_file")).toBe(true);

    const discEvents = emittedEvents.filter(
      (e) => e.type === "tool.discovered",
    );
    expect(discEvents.length).toBeGreaterThanOrEqual(1);

    await proxy.stop();
  });

  it("blocks tool calls violating security policy (e.g. .env) without invoking downstream server", async () => {
    const emittedEvents: AgentEvent[] = [];
    const eventSink = {
      emit: async (e: AgentEvent) => {
        emittedEvents.push(e);
      },
    };

    const proxy = new McpStdioProxy({
      command: "node",
      args: [mockServerPath],
      sessionId,
      workspaceRoot: "/app",
      repository,
      policyEngine: new PolicyEngine(),
      eventSink,
      clientInputStream: clientIn,
      clientOutputStream: clientOut,
      logStream: logOut,
    });

    await proxy.start();

    const response = await sendRpcRequest(proxy, {
      jsonrpc: "2.0",
      id: 99,
      method: "tools/call",
      params: {
        name: "read_file",
        arguments: { path: ".env" },
      },
    });

    expect(response.id).toBe(99);
    expect(response.result.isError).toBe(true);
    expect(response.result.content[0].text).toContain("blocked by policy");
    expect(response.result.content[0].text).not.toContain(
      "DOWNSTREAM_EXECUTION_SUCCESS",
    );

    const blockedEvent = emittedEvents.find((e) => e.type === "action.blocked");
    expect(blockedEvent).toBeDefined();

    await proxy.stop();
  });

  it("ADVERSARIAL: blocks path traversal (../../etc/shadow) over MCP without invoking downstream", async () => {
    const emittedEvents: AgentEvent[] = [];
    const eventSink = {
      emit: async (e: AgentEvent) => {
        emittedEvents.push(e);
      },
    };

    const proxy = new McpStdioProxy({
      command: "node",
      args: [mockServerPath],
      sessionId,
      workspaceRoot: "/app",
      repository,
      policyEngine: new PolicyEngine(),
      eventSink,
      clientInputStream: clientIn,
      clientOutputStream: clientOut,
      logStream: logOut,
    });

    await proxy.start();

    const response = await sendRpcRequest(proxy, {
      jsonrpc: "2.0",
      id: 101,
      method: "tools/call",
      params: {
        name: "read_file",
        arguments: { path: "../../etc/shadow" },
      },
    });

    expect(response.id).toBe(101);
    expect(response.result.isError).toBe(true);
    // Mandatory deny-outside-workspace must trigger
    expect(response.result.content[0].text).toContain("blocked by policy");
    expect(response.result.content[0].text).not.toContain(
      "DOWNSTREAM_EXECUTION_SUCCESS",
    );

    await proxy.stop();
  });

  it("ADVERSARIAL: immediately blocks tool calls when Kill Switch is active in SQLite", async () => {
    repository.setKillSwitch(sessionId, true, "Emergency operator kill switch");

    const emittedEvents: AgentEvent[] = [];
    const eventSink = {
      emit: async (e: AgentEvent) => {
        emittedEvents.push(e);
      },
    };

    const proxy = new McpStdioProxy({
      command: "node",
      args: [mockServerPath],
      sessionId,
      workspaceRoot: "/app",
      repository,
      policyEngine: new PolicyEngine(),
      eventSink,
      clientInputStream: clientIn,
      clientOutputStream: clientOut,
      logStream: logOut,
    });

    await proxy.start();

    const response = await sendRpcRequest(proxy, {
      jsonrpc: "2.0",
      id: 500,
      method: "tools/call",
      params: {
        name: "read_file",
        arguments: { path: "safe.txt" },
      },
    });

    expect(response.id).toBe(500);
    expect(response.result.isError).toBe(true);
    expect(response.result.content[0].text).toContain(
      "killed by operator kill switch",
    );
    expect(response.result.content[0].text).not.toContain(
      "DOWNSTREAM_EXECUTION_SUCCESS",
    );

    // Resume session
    repository.setKillSwitch(sessionId, false);
    const resumeResponse = await sendRpcRequest(proxy, {
      jsonrpc: "2.0",
      id: 501,
      method: "tools/call",
      params: {
        name: "read_file",
        arguments: { path: "safe.txt" },
      },
    });

    expect(resumeResponse.id).toBe(501);
    expect(resumeResponse.result.content[0].text).toBe(
      "DOWNSTREAM_EXECUTION_SUCCESS",
    );

    await proxy.stop();
  });

  it("ADVERSARIAL: rug-pull schema mutation retains immutable baseline and continues to report TOOL_CHANGED", () => {
    // 1. Initial discovery
    const r1 = repository.recordToolFingerprint({
      id: "tf_1",
      sessionId,
      toolName: "calc",
      source: "mcp:math-server",
      fingerprint: "hash_baseline_v1",
      schemaJson: JSON.stringify({ type: "object" }),
      description: "Calculator",
      firstSeenAt: 1000,
      lastSeenAt: 1000,
    });
    expect(r1.status).toBe("TOOL_DISCOVERED");
    expect(r1.changeCount).toBe(0);

    // 2. Unchanged call
    const r2 = repository.recordToolFingerprint({
      id: "tf_2",
      sessionId,
      toolName: "calc",
      source: "mcp:math-server",
      fingerprint: "hash_baseline_v1",
      schemaJson: JSON.stringify({ type: "object" }),
      description: "Calculator",
      firstSeenAt: 1000,
      lastSeenAt: 2000,
    });
    expect(r2.status).toBe("TOOL_UNCHANGED");

    // 3. Mutated call (rug-pull)
    const r3 = repository.recordToolFingerprint({
      id: "tf_3",
      sessionId,
      toolName: "calc",
      source: "mcp:math-server",
      fingerprint: "hash_mutated_v2",
      schemaJson: JSON.stringify({
        type: "object",
        properties: { evil: true },
      }),
      description: "Mutated Calculator",
      firstSeenAt: 1000,
      lastSeenAt: 3000,
    });
    expect(r3.status).toBe("TOOL_CHANGED");
    expect(r3.changeCount).toBe(1);

    // 4. Subsequent call with same mutated hash must STILL report TOOL_CHANGED against baseline!
    const r4 = repository.recordToolFingerprint({
      id: "tf_4",
      sessionId,
      toolName: "calc",
      source: "mcp:math-server",
      fingerprint: "hash_mutated_v2",
      schemaJson: JSON.stringify({
        type: "object",
        properties: { evil: true },
      }),
      description: "Mutated Calculator",
      firstSeenAt: 1000,
      lastSeenAt: 4000,
    });
    expect(r4.status).toBe("TOOL_CHANGED");
    expect(r4.changeCount).toBe(1);

    // Verify baseline in SQLite
    const fps = repository.getToolFingerprints(sessionId);
    const calc = fps.find((f) => f.toolName === "calc");
    expect(calc.initialFingerprint).toBe("hash_baseline_v1");
    expect(calc.fingerprint).toBe("hash_mutated_v2");
  });

  it("ADVERSARIAL: multi-server tool isolation prevents cross-server fingerprint collisions", () => {
    // Server A: read_file
    const sA = repository.recordToolFingerprint({
      id: "tf_A",
      sessionId,
      toolName: "read_file",
      source: "mcp:server-a",
      fingerprint: "fp_server_a",
      schemaJson: "{}",
      description: "Server A reader",
      firstSeenAt: 1000,
      lastSeenAt: 1000,
    });
    expect(sA.status).toBe("TOOL_DISCOVERED");

    // Server B: read_file with different schema
    const sB = repository.recordToolFingerprint({
      id: "tf_B",
      sessionId,
      toolName: "read_file",
      source: "mcp:server-b",
      fingerprint: "fp_server_b",
      schemaJson: "{}",
      description: "Server B reader",
      firstSeenAt: 1000,
      lastSeenAt: 1000,
    });
    // Must NOT be treated as TOOL_CHANGED on Server A! Must be separate TOOL_DISCOVERED!
    expect(sB.status).toBe("TOOL_DISCOVERED");

    const tools = repository.getToolFingerprints(sessionId);
    expect(tools).toHaveLength(2);
    expect(tools.find((t) => t.source === "mcp:server-a")?.fingerprint).toBe(
      "fp_server_a",
    );
    expect(tools.find((t) => t.source === "mcp:server-b")?.fingerprint).toBe(
      "fp_server_b",
    );
  });

  it("ADVERSARIAL: inspector truncates payloads exceeding 500KB and warns on private key leaks", async () => {
    const { McpResultInspector } = await import("../src/mcp/inspector.js");

    // 1. Oversized result
    const hugeText = "A".repeat(600 * 1024);
    const oversizedResult = {
      content: [{ type: "text", text: hugeText }],
    };
    const inspected = McpResultInspector.inspect(oversizedResult);
    expect(inspected.modified).toBe(true);
    expect(inspected.result.content[0].text).toContain(
      "truncated output because it exceeded",
    );
    expect(inspected.result.content[0].text.length).toBeLessThan(15000);

    // 2. Secret leakage detection
    const leakResult = {
      content: [
        {
          type: "text",
          text: "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----",
        },
      ],
    };
    const leakInspection = McpResultInspector.inspect(leakResult);
    expect(leakInspection.warning).toContain(
      "cryptographic private key material",
    );
  });

  it("ADVERSARIAL: BehavioralEngine reconstructs sensitive sequence context across process restarts", () => {
    const engine = new BehavioralEngine();
    const testSession = "ses_reconstruct_test";

    // Simulate past events stored in SQLite from a previous session
    const pastEvents = [
      {
        type: "action.completed",
        actionId: "act_sens_1",
        kind: "file.read",
        params: { path: ".env" },
        timestamp: 1000,
      },
    ];

    engine.reconstructFromEvents(testSession, pastEvents);

    const ctx = engine.getContext(testSession);
    expect(ctx.sensitiveReads).toHaveLength(1);
    expect(ctx.sensitiveReads[0].path).toBe(".env");

    // Subsequent outbound network call triggers SEC_SENSITIVE_TO_NETWORK exfiltration rule!
    const matches = engine.evaluate(testSession, {
      actionId: "act_net_2",
      kind: "network.request",
      params: { url: "https://attacker.com/leak" },
    });

    expect(matches.some((m) => m.ruleId === "SEC_SENSITIVE_TO_NETWORK")).toBe(
      true,
    );
  });

  it("ADVERSARIAL (VULN-01): JSON-RPC batch containing tools/call is fully intercepted and evaluated per item", async () => {
    const emittedEvents: AgentEvent[] = [];
    const eventSink = {
      emit: async (e: AgentEvent) => {
        emittedEvents.push(e);
      },
    };

    const proxy = new McpStdioProxy({
      command: "node",
      args: [mockServerPath],
      sessionId,
      workspaceRoot: "/app",
      repository,
      policyEngine: new PolicyEngine(),
      eventSink,
      clientInputStream: clientIn,
      clientOutputStream: clientOut,
      logStream: logOut,
    });

    await proxy.start();

    // Adversarial batch: item 0 tries to read .env (DENIED by policy), item 1 reads safe file (ALLOWED)
    const batch = [
      {
        jsonrpc: "2.0",
        id: 501,
        method: "tools/call",
        params: { name: "read_file", arguments: { path: ".env" } },
      },
      {
        jsonrpc: "2.0",
        id: 502,
        method: "tools/call",
        params: { name: "read_file", arguments: { path: "src/safe.ts" } },
      },
    ];

    const response = await sendRpcRequest(proxy, batch);
    expect(Array.isArray(response)).toBe(true);
    expect(response).toHaveLength(2);

    const resDeny = response.find((r: any) => r.id === 501);
    const resAllow = response.find((r: any) => r.id === 502);

    expect(resDeny).toBeDefined();
    expect(resDeny.result.isError).toBe(true);
    expect(resDeny.result.content[0].text).toContain("blocked by policy");

    expect(resAllow).toBeDefined();
    expect(resAllow.result.content[0].text).toContain(
      "DOWNSTREAM_EXECUTION_SUCCESS",
    );

    // Verify events were generated for both
    const blockedEvents = emittedEvents.filter(
      (e) => e.type === "action.blocked",
    );
    expect(blockedEvents).toHaveLength(1);
    const completedEvents = emittedEvents.filter(
      (e) => e.type === "action.completed",
    );
    expect(completedEvents).toHaveLength(1);

    await proxy.stop();
  });

  it("ADVERSARIAL (VULN-02): tools/call notification without id is rejected with -32600 error and never forwarded", async () => {
    const emittedEvents: AgentEvent[] = [];
    const eventSink = {
      emit: async (e: AgentEvent) => {
        emittedEvents.push(e);
      },
    };

    const proxy = new McpStdioProxy({
      command: "node",
      args: [mockServerPath],
      sessionId,
      workspaceRoot: "/app",
      repository,
      policyEngine: new PolicyEngine(),
      eventSink,
      clientInputStream: clientIn,
      clientOutputStream: clientOut,
      logStream: logOut,
    });

    await proxy.start();

    // Notification without id attempting tool call
    const notifMsg = {
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: "read_file", arguments: { path: ".env" } },
    };

    const response = await sendRpcRequest(proxy, notifMsg);
    expect(response.error).toBeDefined();
    expect(response.error.code).toBe(-32600);
    expect(response.error.message).toContain(
      "cannot be invoked as a notification",
    );

    // No action started or completed event emitted
    expect(
      emittedEvents.filter((e) => e.type === "action.started"),
    ).toHaveLength(0);

    await proxy.stop();
  });

  it("ADVERSARIAL (VULN-04): dynamically mutated tool requires operator approval (ASK) and cannot execute silently under ALLOW", async () => {
    const emittedEvents: AgentEvent[] = [];
    const eventSink = {
      emit: async (e: AgentEvent) => {
        emittedEvents.push(e);
      },
    };

    // First, register a baseline tool in SQLite
    repository.recordToolFingerprint({
      id: "tf_initial",
      sessionId,
      toolName: "read_file",
      source: "mcp:node",
      fingerprint: "baseline_hash_123",
      schemaJson: JSON.stringify({
        type: "object",
        properties: { path: { type: "string" } },
      }),
      description: "Read file",
      firstSeenAt: 1000,
      lastSeenAt: 1000,
    });

    // Next, simulate runtime schema mutation (rug-pull)
    repository.recordToolFingerprint({
      id: "tf_mutated",
      sessionId,
      toolName: "read_file",
      source: "mcp:node",
      fingerprint: "mutated_hash_456",
      schemaJson: JSON.stringify({
        type: "object",
        properties: { path: { type: "string" }, exfil: { type: "string" } },
      }),
      description: "Read file with added parameter",
      firstSeenAt: 1000,
      lastSeenAt: 2000,
    });

    expect(repository.isToolMutated(sessionId, "read_file")).toBe(true);

    const proxy = new McpStdioProxy({
      command: "node",
      args: [mockServerPath],
      sessionId,
      workspaceRoot: "/app",
      repository,
      policyEngine: new PolicyEngine(),
      eventSink,
      clientInputStream: clientIn,
      clientOutputStream: clientOut,
      logStream: logOut,
    });

    await proxy.start();

    // Call mutated tool on a normally allowed path
    const response = await sendRpcRequest(proxy, {
      jsonrpc: "2.0",
      id: 701,
      method: "tools/call",
      params: { name: "read_file", arguments: { path: "src/safe.ts" } },
    });

    expect(response.id).toBe(701);
    expect(response.result.isError).toBe(true);
    // Since no approval manager was configured, ASK auto-denies for safety
    expect(response.result.content[0].text).toContain(
      "Action requires human approval",
    );

    // Verify policy evaluated event recorded ASK with ask-mutated-tools
    const policyEv = emittedEvents.find(
      (e) => e.type === "policy.evaluated",
    ) as any;
    expect(policyEv).toBeDefined();
    expect(policyEv.decision).toBe("ASK");
    expect(policyEv.matchedPolicies).toContain("ask-mutated-tools");

    await proxy.stop();
  });

  it("ADVERSARIAL: intercepts resources/read and blocks path traversal outside workspace", async () => {
    const emittedEvents: AgentEvent[] = [];
    const eventSink = {
      emit: async (e: AgentEvent) => {
        emittedEvents.push(e);
      },
    };

    const proxy = new McpStdioProxy({
      command: "node",
      args: [mockServerPath],
      sessionId,
      workspaceRoot: "/app",
      repository,
      policyEngine: new PolicyEngine(),
      eventSink,
      clientInputStream: clientIn,
      clientOutputStream: clientOut,
      logStream: logOut,
    });

    await proxy.start();

    // Attempt to read sensitive file outside workspace via resources/read
    const response = await sendRpcRequest(proxy, {
      jsonrpc: "2.0",
      id: 801,
      method: "resources/read",
      params: { uri: "file:///etc/passwd" },
    });

    expect(response.id).toBe(801);
    expect(response.result.isError).toBe(true);
    expect(response.result.content[0].text).toContain("Security Violation");
    expect(response.result.content[0].text).toContain(
      "outside the designated workspace root",
    );

    // Verify action.blocked event was emitted with HIGH risk
    const blockedEv = emittedEvents.find(
      (e) => e.type === "action.blocked",
    ) as any;
    expect(blockedEv).toBeDefined();
    expect(blockedEv.kind).toBe("file.read");
    expect(blockedEv.risk.level).toBe("HIGH");

    await proxy.stop();
  });

  it("ADVERSARIAL: interceptResourceRead blocks RFC 8089 file://localhost/ traversal and remote URIs", async () => {
    const emittedEvents: AgentEvent[] = [];
    const eventSink = {
      emit: async (e: AgentEvent) => {
        emittedEvents.push(e);
      },
    };

    const proxy = new McpStdioProxy({
      command: "node",
      args: [mockServerPath],
      sessionId,
      workspaceRoot: "/app",
      repository,
      policyEngine: new PolicyEngine(),
      eventSink,
      clientInputStream: clientIn,
      clientOutputStream: clientOut,
      logStream: logOut,
    });

    await proxy.start();

    // 1. RFC 8089 explicit localhost URI
    const res1 = await sendRpcRequest(proxy, {
      jsonrpc: "2.0",
      id: 810,
      method: "resources/read",
      params: { uri: "file://localhost/etc/shadow" },
    });
    expect(res1.result.isError).toBe(true);
    expect(res1.result.content[0].text).toContain("Security Violation");
    expect(res1.result.content[0].text).not.toContain(
      "DOWNSTREAM_RESOURCE_SUCCESS",
    );

    // 2. Remote / IP host file URI (fail closed)
    const res2 = await sendRpcRequest(proxy, {
      jsonrpc: "2.0",
      id: 811,
      method: "resources/read",
      params: { uri: "file://127.0.0.1/etc/shadow" },
    });
    expect(res2.result.isError).toBe(true);
    expect(res2.result.content[0].text).toContain("Security Violation");

    // 3. Remote scheme URI (e.g. s3:// or http://)
    const res3 = await sendRpcRequest(proxy, {
      jsonrpc: "2.0",
      id: 812,
      method: "resources/read",
      params: { uri: "s3://production-secrets/db.key" },
    });
    expect(res3.result.isError).toBe(true);
    expect(res3.result.content[0].text).toContain("Security Violation");

    await proxy.stop();
  });

  it("ADVERSARIAL: blocks resources/read when kill switch is active", async () => {
    const emittedEvents: AgentEvent[] = [];
    const eventSink = {
      emit: async (e: AgentEvent) => {
        emittedEvents.push(e);
      },
    };

    // Activate authoritative kill switch in repository
    repository.setKillSwitch(
      sessionId,
      true,
      "Emergency halt on resource exfiltration",
    );

    const proxy = new McpStdioProxy({
      command: "node",
      args: [mockServerPath],
      sessionId,
      workspaceRoot: "/app",
      repository,
      policyEngine: new PolicyEngine(),
      eventSink,
      clientInputStream: clientIn,
      clientOutputStream: clientOut,
      logStream: logOut,
    });

    await proxy.start();

    const response = await sendRpcRequest(proxy, {
      jsonrpc: "2.0",
      id: 802,
      method: "resources/read",
      params: { uri: "file:///app/src/safe.ts" },
    });

    expect(response.id).toBe(802);
    expect(response.result.isError).toBe(true);
    expect(response.result.content[0].text).toContain("operator kill switch");

    // Verify action.blocked event was recorded
    const blockedEv = emittedEvents.find(
      (e) => e.type === "action.blocked",
    ) as any;
    expect(blockedEv).toBeDefined();
    expect(blockedEv.reason).toContain("operator kill switch");

    await proxy.stop();
  });
});

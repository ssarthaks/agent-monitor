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

describe("MCP Gateway V4 Production Controls", () => {
  let mockServerPath: string;
  let clientIn: PassThrough;
  let clientOut: PassThrough;
  let logOut: PassThrough;
  let repository: SessionRepository;
  let db: any;
  const sessionId = "ses_mcp_v4_test";

  beforeEach(() => {
    mockServerPath = path.join(
      process.cwd(),
      "packages/gateway/test/mock-mcp-v4-server.cjs",
    );
    const mockServerCode = `
      const readline = require('readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

      rl.on('line', (line) => {
        if (!line.trim()) return;
        try {
          const req = JSON.parse(line);
          if (req.method === 'tools/call') {
            if (req.params && req.params.name === 'leak_secret') {
              console.log(JSON.stringify({
                jsonrpc: '2.0',
                id: req.id,
                result: {
                  content: [{ type: 'text', text: 'Token: AKIAIOSFODNN7EXAMPLE secret_payload' }]
                }
              }));
            } else if (req.params && req.params.name === 'slow_operation') {
              // Delay response to trigger timeout
              setTimeout(() => {
                console.log(JSON.stringify({
                  jsonrpc: '2.0',
                  id: req.id,
                  result: { content: [{ type: 'text', text: 'delayed_success' }] }
                }));
              }, 400);
            } else {
              console.log(JSON.stringify({
                jsonrpc: '2.0',
                id: req.id,
                result: {
                  content: [{ type: 'text', text: 'STANDARD_EXECUTION_SUCCESS' }]
                }
              }));
            }
          } else if (req.method === 'resources/read') {
            if (req.params && req.params.uri === 'file:///app/secret.pem') {
              console.log(JSON.stringify({
                jsonrpc: '2.0',
                id: req.id,
                result: {
                  contents: [{ uri: req.params.uri, text: '-----BEGIN RSA PRIVATE KEY-----\\nMIIEowIBAAKCAQEA...' }]
                }
              }));
            } else {
              console.log(JSON.stringify({
                jsonrpc: '2.0',
                id: req.id,
                result: {
                  contents: [{ uri: req.params ? req.params.uri : '', text: 'RESOURCE_OK' }]
                }
              }));
            }
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
      agentId: "mcp-v4-client",
      agentName: "MCP V4 Client",
      provider: "mcp",
      model: "mock-v4-server",
      workspaceRoot: "/app",
      task: "Test MCP V4 gateway controls",
      status: "running",
      startedAt: Date.now(),
    });
  });

  afterEach(() => {
    try {
      if (fs.existsSync(mockServerPath)) {
        fs.unlinkSync(mockServerPath);
      }
    } catch {}
    if (db) db.close();
  });

  async function sendRequest(proxy: McpStdioProxy, request: any): Promise<any> {
    return new Promise((resolve) => {
      const onData = (chunk: Buffer) => {
        const lines = chunk.toString("utf8").split("\n");
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.id === request.id) {
              clientOut.removeListener("data", onData);
              resolve(parsed);
              return;
            }
          } catch {}
        }
      };
      clientOut.on("data", onData);
      clientIn.write(JSON.stringify(request) + "\n");
    });
  }

  it("1. Quarantined MCP source blocks tool calls and resource reads immediately", async () => {
    const emittedEvents: AgentEvent[] = [];
    const eventSink = {
      emit: async (ev: AgentEvent) => {
        emittedEvents.push(ev);
      },
    };

    const serverName = "untrusted-server";
    const sourceId = `mcp:${serverName}`;

    // Quarantine the source in SQLite
    repository.upsertMcpSource({
      sourceId,
      name: serverName,
      command: "node",
      args: [mockServerPath],
      status: "HEALTHY",
    });
    repository.quarantineSource(sourceId, "Compromised credential reported");

    expect(repository.isSourceQuarantined(sourceId)).toBe(true);

    const proxy = new McpStdioProxy({
      command: "node",
      args: [mockServerPath],
      sessionId,
      serverName,
      workspaceRoot: "/app",
      repository,
      eventSink,
      policyEngine: new PolicyEngine([
        {
          id: "allow-all",
          action: "ALLOW",
          priority: 1,
        },
      ]),
      riskAnalyzer: new RiskAnalyzer(),
      clientInputStream: clientIn,
      clientOutputStream: clientOut,
      logStream: logOut,
    });

    await proxy.start();

    // Attempt tools/call
    const toolRes = await sendRequest(proxy, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "standard_tool", arguments: {} },
    });

    expect(toolRes.result.isError).toBe(true);
    expect(toolRes.result.content[0].text).toContain("quarantined");

    const blockedEvent = emittedEvents.find(
      (e) =>
        e.type === "action.blocked" &&
        (e as any).reason.includes("quarantined"),
    );
    expect(blockedEvent).toBeDefined();

    // Trust source and re-try
    repository.trustSource(sourceId);
    expect(repository.isSourceQuarantined(sourceId)).toBe(false);

    const allowedRes = await sendRequest(proxy, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "standard_tool", arguments: {} },
    });

    expect(allowedRes.result.content[0].text).toBe(
      "STANDARD_EXECUTION_SUCCESS",
    );

    await proxy.stop();
  });

  it("2. Rate limiter enforces maximum requests per minute", async () => {
    const emittedEvents: AgentEvent[] = [];
    const eventSink = {
      emit: async (ev: AgentEvent) => {
        emittedEvents.push(ev);
      },
    };

    const proxy = new McpStdioProxy({
      command: "node",
      args: [mockServerPath],
      sessionId,
      serverName: "rate-limited-server",
      workspaceRoot: "/app",
      repository,
      eventSink,
      policyEngine: new PolicyEngine([
        {
          id: "allow-all",
          action: "ALLOW",
          priority: 1,
        },
      ]),
      riskAnalyzer: new RiskAnalyzer(),
      rateLimitPerMinute: 2, // Allow only 2 requests
      clientInputStream: clientIn,
      clientOutputStream: clientOut,
      logStream: logOut,
    });

    await proxy.start();

    // Request 1: OK
    const res1 = await sendRequest(proxy, {
      jsonrpc: "2.0",
      id: 101,
      method: "tools/call",
      params: { name: "standard_tool", arguments: {} },
    });
    expect(res1.result.content[0].text).toBe("STANDARD_EXECUTION_SUCCESS");

    // Request 2: OK
    const res2 = await sendRequest(proxy, {
      jsonrpc: "2.0",
      id: 102,
      method: "tools/call",
      params: { name: "standard_tool", arguments: {} },
    });
    expect(res2.result.content[0].text).toBe("STANDARD_EXECUTION_SUCCESS");

    // Request 3: Exceeds rate limit
    const res3 = await sendRequest(proxy, {
      jsonrpc: "2.0",
      id: 103,
      method: "tools/call",
      params: { name: "standard_tool", arguments: {} },
    });
    expect(res3.error).toBeDefined();
    expect(res3.error.code).toBe(-32000);
    expect(res3.error.message).toContain("Rate limit exceeded");

    await proxy.stop();
  });

  it("3. Request timeout aborts delayed downstream operations", async () => {
    const emittedEvents: AgentEvent[] = [];
    const eventSink = {
      emit: async (ev: AgentEvent) => {
        emittedEvents.push(ev);
      },
    };

    const proxy = new McpStdioProxy({
      command: "node",
      args: [mockServerPath],
      sessionId,
      serverName: "timeout-server",
      workspaceRoot: "/app",
      repository,
      eventSink,
      policyEngine: new PolicyEngine([
        {
          id: "allow-all",
          action: "ALLOW",
          priority: 1,
        },
      ]),
      riskAnalyzer: new RiskAnalyzer(),
      requestTimeoutMs: 150, // 150ms timeout; mock server delays 400ms for slow_operation
      clientInputStream: clientIn,
      clientOutputStream: clientOut,
      logStream: logOut,
    });

    await proxy.start();

    const timeoutRes = await sendRequest(proxy, {
      jsonrpc: "2.0",
      id: 201,
      method: "tools/call",
      params: { name: "slow_operation", arguments: {} },
    });

    expect(timeoutRes.error).toBeDefined();
    expect(timeoutRes.error.code).toBe(-32000);
    expect(timeoutRes.error.message).toContain("timed out after 150ms");

    await proxy.stop();
  });

  it("4. Detects secrets in tool output and resource content and escalates risk to CRITICAL", async () => {
    const emittedEvents: AgentEvent[] = [];
    const eventSink = {
      emit: async (ev: AgentEvent) => {
        emittedEvents.push(ev);
      },
    };

    const proxy = new McpStdioProxy({
      command: "node",
      args: [mockServerPath],
      sessionId,
      serverName: "leak-test-server",
      workspaceRoot: "/app",
      repository,
      eventSink,
      policyEngine: new PolicyEngine([
        {
          id: "allow-all",
          action: "ALLOW",
          priority: 1,
        },
      ]),
      riskAnalyzer: new RiskAnalyzer(),
      clientInputStream: clientIn,
      clientOutputStream: clientOut,
      logStream: logOut,
    });

    await proxy.start();

    // 1. Tool call output containing AWS credential
    const leakToolRes = await sendRequest(proxy, {
      jsonrpc: "2.0",
      id: 301,
      method: "tools/call",
      params: { name: "leak_secret", arguments: {} },
    });

    expect(leakToolRes.result).toBeDefined();
    const toolCompletedEv = emittedEvents.find(
      (e) =>
        e.type === "action.completed" &&
        ((e as any).result?.content?.[0]?.text?.includes(
          "AKIAIOSFODNN7EXAMPLE",
        ) ||
          (e as any).result?.content?.[0]?.text?.includes(
            "[REDACTED:AWS_ACCESS_KEY]",
          )),
    ) as any;

    expect(toolCompletedEv).toBeDefined();
    expect(toolCompletedEv.risk.level).toBe("CRITICAL");
    expect(toolCompletedEv.risk.score).toBeGreaterThanOrEqual(95);
    expect(
      toolCompletedEv.risk.flags.some(
        (f: any) => f.ruleId === "SECRET_LEAK_OUTPUT",
      ),
    ).toBe(true);

    // 2. Resource read containing RSA Private Key
    const leakResourceRes = await sendRequest(proxy, {
      jsonrpc: "2.0",
      id: 302,
      method: "resources/read",
      params: { uri: "file:///app/secret.pem" },
    });

    expect(leakResourceRes.result).toBeDefined();
    const resCompletedEv = emittedEvents.find(
      (e) =>
        e.type === "action.completed" &&
        ((e as any).result?.contents?.[0]?.text?.includes("PRIVATE_KEY") ||
          (e as any).result?.contents?.[0]?.text?.includes("PRIVATE KEY")),
    ) as any;

    expect(resCompletedEv).toBeDefined();
    expect(resCompletedEv.risk.level).toBe("CRITICAL");
    expect(resCompletedEv.risk.score).toBeGreaterThanOrEqual(95);
    expect(
      resCompletedEv.risk.flags.some(
        (f: any) => f.ruleId === "SECRET_LEAK_OUTPUT",
      ),
    ).toBe(true);

    await proxy.stop();
  });
});

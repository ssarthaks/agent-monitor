import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PassThrough } from "node:stream";
import path from "node:path";
import fs from "node:fs";
import { McpStdioProxy } from "../src/index.js";
import { createDatabase, SessionRepository } from "@agent-monitor/server";
import { PolicyEngine, RiskAnalyzer } from "@agent-monitor/core";

describe("Adversarial MCP Gateway Security Tests", () => {
  let mockServerPath: string;
  let clientIn: PassThrough;
  let clientOut: PassThrough;
  let logOut: PassThrough;
  let repository: SessionRepository;
  let db: any;
  const sessionId = "ses_adv_mcp";

  beforeEach(() => {
    mockServerPath = path.join(
      process.cwd(),
      "packages/gateway/test/mock-adv-mcp-server.cjs",
    );
    const mockServerCode = `
      const readline = require('readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

      rl.on('line', (line) => {
        if (!line.trim()) return;
        try {
          const req = JSON.parse(line);
          if (req.id !== undefined) {
            console.log(JSON.stringify({
              jsonrpc: '2.0',
              id: req.id,
              result: { success: true, methodCalled: req.method }
            }));
          }
        } catch (e) {}
      });
      rl.on('close', () => process.exit(0));
    `;
    fs.writeFileSync(mockServerPath, mockServerCode, "utf8");

    clientIn = new PassThrough();
    clientOut = new PassThrough();
    logOut = new PassThrough();

    db = createDatabase(":memory:");
    repository = new SessionRepository(db);

    repository.createSession({
      id: sessionId,
      agentId: "agent_adv_mcp",
      agentName: "MCP Adv Test Agent",
      provider: "mock",
      model: "mock-model",
      workspaceRoot: "/tmp",
      task: "Adversarial MCP tests",
      startedAt: 1000,
      status: "running",
      riskScore: 0,
    });
  });

  afterEach(() => {
    if (fs.existsSync(mockServerPath)) {
      try {
        fs.unlinkSync(mockServerPath);
      } catch {}
    }
    db.close();
  });

  function sendRpcRequest(msg: any): Promise<any> {
    return new Promise((resolve) => {
      const onData = (data: Buffer) => {
        const lines = data.toString("utf8").split("\n");
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line.trim());
            if (msg.id === undefined && parsed.error) {
              clientOut.off("data", onData);
              resolve(parsed);
              return;
            }
            if (parsed.id === msg.id) {
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

  it("blocks tools/call requests when the MCP source is quarantined", async () => {
    repository.upsertMcpSource({
      sourceId: "mcp:evil-server",
      name: "evil-server",
      command: "node",
      args: [mockServerPath],
      status: "QUARANTINED",
      trustState: "UNTRUSTED",
      transport: "stdio",
      fingerprint: "abc123",
      retrustRequired: true,
    });

    const proxy = new McpStdioProxy({
      command: "node",
      args: [mockServerPath],
      sessionId,
      agentId: "agent_adv_mcp",
      workspaceRoot: "/tmp",
      serverName: "evil-server",
      repository,
      policyEngine: new PolicyEngine({ policy: { default: "ALLOW" } }),
      riskAnalyzer: new RiskAnalyzer(),
      eventSink: { emit: async () => {} },
      clientInputStream: clientIn,
      clientOutputStream: clientOut,
      logStream: logOut,
    });

    await proxy.start();

    const response = await sendRpcRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "test_tool", arguments: {} },
    });

    expect(response.result).toBeDefined();
    expect(response.result.isError).toBe(true);
    expect(response.result.content[0].text).toMatch(/quarantined/i);

    await proxy.stop();
  });

  it("detects command/arg rug-pull mutation and flags retrustRequired", () => {
    const initialSource = repository.upsertMcpSource({
      sourceId: "source-rugpull-1",
      name: "filesystem-server",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      trustState: "TRUSTED",
      transport: "stdio",
      fingerprint: "fp_v1",
      retrustRequired: false,
    });
    expect(initialSource.trustState).toBe("TRUSTED");
    expect(initialSource.retrustRequired).toBe(false);

    const mutatedSource = repository.upsertMcpSource({
      sourceId: "source-rugpull-1",
      name: "filesystem-server",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/etc"],
      trustState: "TRUSTED",
      transport: "stdio",
      fingerprint: "fp_v2",
      retrustRequired: false,
    });

    expect(mutatedSource.trustState).toBe("UNTRUSTED");
    expect(mutatedSource.retrustRequired).toBe(true);
  });

  it("blocks notification bypass attempts on tools/call (missing id)", async () => {
    const proxy = new McpStdioProxy({
      command: "node",
      args: [mockServerPath],
      sessionId,
      agentId: "agent_adv_mcp",
      workspaceRoot: "/tmp",
      repository,
      policyEngine: new PolicyEngine({ policy: { default: "ALLOW" } }),
      riskAnalyzer: new RiskAnalyzer(),
      eventSink: { emit: async () => {} },
      clientInputStream: clientIn,
      clientOutputStream: clientOut,
      logStream: logOut,
    });

    await proxy.start();

    const response = await sendRpcRequest({
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: "test_tool", arguments: {} },
    });

    expect(response.error).toBeDefined();
    expect(response.error.code).toBe(-32600);
    expect(response.error.message).toContain(
      "cannot be invoked as a notification",
    );

    await proxy.stop();
  });

  it("blocks notification bypass attempts on resources/read (missing id)", async () => {
    const proxy = new McpStdioProxy({
      command: "node",
      args: [mockServerPath],
      sessionId,
      agentId: "agent_adv_mcp",
      workspaceRoot: "/tmp",
      repository,
      policyEngine: new PolicyEngine({ policy: { default: "ALLOW" } }),
      riskAnalyzer: new RiskAnalyzer(),
      eventSink: { emit: async () => {} },
      clientInputStream: clientIn,
      clientOutputStream: clientOut,
      logStream: logOut,
    });

    await proxy.start();

    const response = await sendRpcRequest({
      jsonrpc: "2.0",
      method: "resources/read",
      params: { uri: "file:///tmp/test.txt" },
    });

    expect(response.error).toBeDefined();
    expect(response.error.code).toBe(-32600);
    expect(response.error.message).toContain(
      "cannot be invoked as a notification",
    );

    await proxy.stop();
  });
});

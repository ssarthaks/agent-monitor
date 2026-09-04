import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PassThrough } from "node:stream";
import path from "node:path";
import fs from "node:fs";
import { McpStdioProxy } from "../src/index.js";
import { McpResultInspector } from "../src/mcp/inspector.js";
import { JsonRpcStreamParser } from "../src/index.js";
import { createDatabase, SessionRepository } from "@agent-monitor/server";
import { PolicyEngine, RiskAnalyzer } from "@agent-monitor/core";

describe("Resource Exhaustion & Payload Hardening Tests", () => {
  let mockServerPath: string;
  let clientIn: PassThrough;
  let clientOut: PassThrough;
  let logOut: PassThrough;
  let repository: SessionRepository;
  let db: any;
  const sessionId = "ses_res_exhaust";

  beforeEach(() => {
    mockServerPath = path.join(
      process.cwd(),
      "packages/gateway/test/mock-exhaust-server.cjs"
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
              result: { content: [{ type: 'text', text: 'ok' }] }
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
      agentId: "agent_exhaust",
      agentName: "Exhaustion Test Agent",
      provider: "mock",
      model: "mock-model",
      workspaceRoot: "/tmp",
      task: "Resource exhaustion tests",
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

  it("rejects tool call arguments exceeding 1MB limit with -32602", async () => {
    const proxy = new McpStdioProxy({
      command: "node",
      args: [mockServerPath],
      sessionId,
      agentId: "agent_exhaust",
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

    // Create arguments exceeding 1MB (1,048,576 bytes)
    const largePayload = "X".repeat(1.2 * 1024 * 1024);
    const response = await sendRpcRequest({
      jsonrpc: "2.0",
      id: 99,
      method: "tools/call",
      params: { name: "large_tool", arguments: { data: largePayload } },
    });

    expect(response.error).toBeDefined();
    expect(response.error.code).toBe(-32602);
    expect(response.error.message).toMatch(/exceed maximum allowed payload size of 1MB/);

    await proxy.stop();
  });

  it("truncates tool result exceeding 500KB in McpResultInspector", () => {
    const hugeOutput = "A".repeat(600 * 1024); // 600 KB
    const resultObj = {
      content: [
        { type: "text", text: hugeOutput },
      ],
    };

    const inspected = McpResultInspector.inspect(resultObj);
    expect(inspected.modified).toBe(true);
    expect(inspected.warning).toContain("truncated");
    const textContent = JSON.stringify(inspected.result);
    expect(textContent).toContain("[WARNING: Agent Monitor truncated output because it exceeded 500 KB limit]");
    expect(textContent.length).toBeLessThan(50 * 1024);
  });

  it("redacts detected secrets in result object and identifies secret types", () => {
    const sensitiveOutput = {
      content: [
        {
          type: "text",
          text: "Here is the key: AKIAIOSFODNN7EXAMPLE and private key: -----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0...",
        },
      ],
    };

    const inspected = McpResultInspector.inspect(sensitiveOutput);
    expect(inspected.secretLeakDetected).toBe(true);
    expect(inspected.secretTypes?.length).toBeGreaterThanOrEqual(1);

    const serialized = JSON.stringify(inspected.result);
    expect(serialized).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(serialized).toContain("[REDACTED:");
  });

  it("rejects Content-Length headers exceeding stream limit", () => {
    const parser = new JsonRpcStreamParser();
    const errors: any[] = [];
    parser.on("error", (err) => errors.push(err));

    parser.write("Content-Length: 104857600\r\n\r\n{}"); // 100MB
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0].message).toMatch(/Invalid JSON-RPC Content-Length/);
  });
});

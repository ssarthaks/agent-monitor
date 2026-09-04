import { describe, it, expect } from "vitest";
import { JsonRpcStreamParser, serializeJsonRpc } from "../src/index.js";

describe("JSON-RPC 2.0 Stream Parser", () => {
  it("parses newline-delimited JSON messages", () => {
    const parser = new JsonRpcStreamParser();
    const received: any[] = [];
    parser.on("message", (msg) => received.push(msg));

    parser.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
    parser.write('{"jsonrpc":"2.0","id":2,"result":{"status":"ok"}}\n');

    expect(received).toHaveLength(2);
    expect(received[0].id).toBe(1);
    expect(received[0].method).toBe("ping");
    expect(received[1].id).toBe(2);
    expect(received[1].result.status).toBe("ok");
  });

  it("handles chunked / fragmented data arrivals across chunks", () => {
    const parser = new JsonRpcStreamParser();
    const received: any[] = [];
    parser.on("message", (msg) => received.push(msg));

    parser.write('{"jsonrpc":"2.0","id":42');
    expect(received).toHaveLength(0);

    parser.write(',"method":"tools/list"}');
    expect(received).toHaveLength(0);

    parser.write("\n");
    expect(received).toHaveLength(1);
    expect(received[0].id).toBe(42);
    expect(received[0].method).toBe("tools/list");
  });

  it("parses Content-Length framed messages (RFC 7230 style)", () => {
    const parser = new JsonRpcStreamParser();
    const received: any[] = [];
    parser.on("message", (msg) => received.push(msg));

    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id: 100,
      method: "initialize",
    });
    const len = Buffer.byteLength(payload, "utf8");
    const framed = `Content-Length: ${len}\r\n\r\n${payload}`;

    parser.write(framed);

    expect(received).toHaveLength(1);
    expect(received[0].id).toBe(100);
    expect(received[0].method).toBe("initialize");
  });

  it("emits error on malformed JSON without crashing parser", () => {
    const parser = new JsonRpcStreamParser();
    const errors: any[] = [];
    const received: any[] = [];

    parser.on("error", (err) => errors.push(err));
    parser.on("message", (msg) => received.push(msg));

    // Send malformed line
    parser.write("{ invalid json ... }\n");
    expect(errors).toHaveLength(1);

    // Send valid line next -> continues operating normally
    parser.write('{"jsonrpc":"2.0","id":99,"method":"valid"}\n');
    expect(received).toHaveLength(1);
    expect(received[0].id).toBe(99);
  });

  it("serializes messages correctly", () => {
    const msg = { jsonrpc: "2.0" as const, id: 1, result: { success: true } };
    const nl = serializeJsonRpc(msg, false);
    expect(nl).toBe('{"jsonrpc":"2.0","id":1,"result":{"success":true}}\n');

    const framed = serializeJsonRpc(msg, true);
    expect(framed).toContain("Content-Length:");
    expect(framed).toContain(
      '\r\n\r\n{"jsonrpc":"2.0","id":1,"result":{"success":true}}',
    );
  });

  it("accurately frames multi-byte UTF-8 characters where byteLength != stringLength", () => {
    const parser = new JsonRpcStreamParser();
    const received: any[] = [];
    parser.on("message", (msg) => received.push(msg));

    // Multi-byte unicode: emojis (4 bytes each) and CJK (3 bytes each)
    const unicodePayload = JSON.stringify({
      jsonrpc: "2.0",
      id: 201,
      result: {
        text: "Agent Monitor 🛡️ 安全监控 — 🚀 Fire & Alert!",
      },
    });

    const byteLen = Buffer.byteLength(unicodePayload, "utf8");
    const charLen = unicodePayload.length;
    expect(byteLen).toBeGreaterThan(charLen);

    const framed = `Content-Length: ${byteLen}\r\n\r\n${unicodePayload}`;
    parser.write(framed);

    expect(received).toHaveLength(1);
    expect(received[0].id).toBe(201);
    expect(received[0].result.text).toBe(
      "Agent Monitor 🛡️ 安全监控 — 🚀 Fire & Alert!",
    );
  });

  it("handles multi-byte UTF-8 characters split across raw byte chunks", () => {
    const parser = new JsonRpcStreamParser();
    const received: any[] = [];
    parser.on("message", (msg) => received.push(msg));

    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id: 202,
      result: { emoji: "🛡️" },
    });
    const byteLen = Buffer.byteLength(payload, "utf8");
    const header = Buffer.from(`Content-Length: ${byteLen}\r\n\r\n`, "utf8");
    const body = Buffer.from(payload, "utf8");
    const full = Buffer.concat([header, body]);

    // Split right in the middle of the body (across the 4-byte emoji)
    const splitPoint = header.length + 20;
    const chunk1 = full.subarray(0, splitPoint);
    const chunk2 = full.subarray(splitPoint);

    parser.write(chunk1);
    expect(received).toHaveLength(0);

    parser.write(chunk2);
    expect(received).toHaveLength(1);
    expect(received[0].id).toBe(202);
    expect(received[0].result.emoji).toBe("🛡️");
  });

  it("rejects negative, non-numeric, or oversized Content-Length", () => {
    const parser = new JsonRpcStreamParser();
    const errors: any[] = [];
    parser.on("error", (err) => errors.push(err));

    // Negative Content-Length
    parser.write("Content-Length: -50\r\n\r\n{}");
    expect(errors.length).toBeGreaterThanOrEqual(1);

    // Oversized Content-Length (> 10MB)
    errors.length = 0;
    parser.write("Content-Length: 999999999\r\n\r\n{}");
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0].message).toContain("Invalid JSON-RPC Content-Length");
  });
});

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
});
